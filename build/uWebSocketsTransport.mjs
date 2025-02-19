import querystring from "querystring";
import uWebSockets from "uWebSockets.js";
import { DummyServer, ErrorCode, matchMaker, getBearerToken, Transport, debugAndPrintError, spliceOne } from "@colyseus/core";
import { uWebSocketClient, uWebSocketWrapper } from "./uWebSocketClient";
class uWebSocketsTransport extends Transport {
  constructor(options = {}, appOptions = {}) {
    super();
    this.clients = [];
    this.clientWrappers = /* @__PURE__ */ new WeakMap();
    this._originalRawSend = null;
    this.app = appOptions.cert_file_name && appOptions.key_file_name ? uWebSockets.SSLApp(appOptions) : uWebSockets.App(appOptions);
    if (options.maxBackpressure === void 0) {
      options.maxBackpressure = 1024 * 1024;
    }
    if (options.compression === void 0) {
      options.compression = uWebSockets.DISABLED;
    }
    if (options.maxPayloadLength === void 0) {
      options.maxPayloadLength = 4 * 1024;
    }
    if (options.sendPingsAutomatically === void 0) {
      options.sendPingsAutomatically = true;
    }
    if (!this.server) {
      this.server = new DummyServer();
    }
    this.app.ws("/*", {
      ...options,
      upgrade: (res, req, context) => {
        const headers = {};
        req.forEach((key, value) => headers[key] = value);
        res.upgrade(
          {
            url: req.getUrl(),
            query: req.getQuery(),
            headers,
            connection: {
              remoteAddress: Buffer.from(res.getRemoteAddressAsText()).toString()
            }
          },
          req.getHeader("sec-websocket-key"),
          req.getHeader("sec-websocket-protocol"),
          req.getHeader("sec-websocket-extensions"),
          context
        );
      },
      open: async (ws) => {
        await this.onConnection(ws);
      },
      close: (ws, code, message) => {
        spliceOne(this.clients, this.clients.indexOf(ws));
        const clientWrapper = this.clientWrappers.get(ws);
        if (clientWrapper) {
          this.clientWrappers.delete(ws);
          clientWrapper.emit("close", code);
        }
      },
      message: (ws, message, isBinary) => {
        this.clientWrappers.get(ws)?.emit("message", Buffer.from(message.slice(0)));
      }
    });
    this.registerMatchMakeRequest();
  }
  listen(port, hostname, backlog, listeningListener) {
    const callback = (listeningSocket) => {
      this._listeningSocket = listeningSocket;
      listeningListener?.();
      this.server.emit("listening");
    };
    if (typeof port === "string") {
      this.app.listen_unix(callback, port);
    } else {
      this.app.listen(port, callback);
    }
    return this;
  }
  shutdown() {
    if (this._listeningSocket) {
      uWebSockets.us_listen_socket_close(this._listeningSocket);
      this.server.emit("close");
    }
  }
  simulateLatency(milliseconds) {
    if (this._originalRawSend == null) {
      this._originalRawSend = uWebSocketClient.prototype.raw;
    }
    const originalRawSend = this._originalRawSend;
    uWebSocketClient.prototype.raw = milliseconds <= Number.EPSILON ? originalRawSend : function() {
      setTimeout(() => originalRawSend.apply(this, arguments), milliseconds);
    };
  }
  async onConnection(rawClient) {
    const wrapper = new uWebSocketWrapper(rawClient);
    this.clients.push(rawClient);
    this.clientWrappers.set(rawClient, wrapper);
    const query = rawClient.query;
    const url = rawClient.url;
    const searchParams = querystring.parse(query);
    const sessionId = searchParams.sessionId;
    const processAndRoomId = url.match(/\/[a-zA-Z0-9_\-]+\/([a-zA-Z0-9_\-]+)$/);
    const roomId = processAndRoomId && processAndRoomId[1];
    const room = matchMaker.getRoomById(roomId);
    const client = new uWebSocketClient(sessionId, wrapper);
    try {
      if (!room || !room.hasReservedSeat(sessionId, searchParams.reconnectionToken)) {
        throw new Error("seat reservation expired.");
      }
      await room._onJoin(client, rawClient);
    } catch (e) {
      debugAndPrintError(e);
      client.error(e.code, e.message, () => rawClient.close());
    }
  }
  registerMatchMakeRequest() {
    const matchmakeRoute = "matchmake";
    const allowedRoomNameChars = /([a-zA-Z_\-0-9]+)/gi;
    const writeHeaders = (req, res) => {
      if (res.aborted) {
        return;
      }
      const headers = Object.assign(
        {},
        matchMaker.controller.DEFAULT_CORS_HEADERS,
        matchMaker.controller.getCorsHeaders.call(void 0, req)
      );
      for (const header in headers) {
        res.writeHeader(header, headers[header].toString());
      }
      return true;
    };
    const writeError = (res, error) => {
      if (res.aborted) {
        return;
      }
      res.writeStatus("406 Not Acceptable");
      res.end(JSON.stringify(error));
    };
    const onAborted = (res) => {
      res.aborted = true;
    };
    this.app.options("/matchmake/*", (res, req) => {
      res.onAborted(() => onAborted(res));
      if (writeHeaders(req, res)) {
        res.writeStatus("204 No Content");
        res.end();
      }
    });
    this.app.post("/matchmake/*", (res, req) => {
      res.onAborted(() => onAborted(res));
      if (matchMaker.isGracefullyShuttingDown) {
        return res.close();
      }
      writeHeaders(req, res);
      res.writeHeader("Content-Type", "application/json");
      const url = req.getUrl();
      const matchedParams = url.match(allowedRoomNameChars);
      const matchmakeIndex = matchedParams.indexOf(matchmakeRoute);
      const authToken = getBearerToken(req.getHeader("authorization"));
      const headers = {};
      req.forEach((key, value) => headers[key] = value);
      this.readJson(res, async (clientOptions) => {
        try {
          if (clientOptions === void 0) {
            throw new Error("invalid JSON input");
          }
          const method = matchedParams[matchmakeIndex + 1];
          const roomName = matchedParams[matchmakeIndex + 2] || "";
          const response = await matchMaker.controller.invokeMethod(
            method,
            roomName,
            clientOptions,
            { token: authToken, request: { headers } }
          );
          if (!res.aborted) {
            res.writeStatus("200 OK");
            res.end(JSON.stringify(response));
          }
        } catch (e) {
          debugAndPrintError(e);
          writeError(res, {
            code: e.code || ErrorCode.MATCHMAKE_UNHANDLED,
            error: e.message
          });
        }
      });
    });
    this.app.get("/matchmake/*", async (res, req) => {
      res.onAborted(() => onAborted(res));
      writeHeaders(req, res);
      res.writeHeader("Content-Type", "application/json");
      const url = req.getUrl();
      const matchedParams = url.match(allowedRoomNameChars);
      const roomName = matchedParams.length > 1 ? matchedParams[matchedParams.length - 1] : "";
      try {
        const response = await matchMaker.controller.getAvailableRooms(roomName || "");
        if (!res.aborted) {
          res.writeStatus("200 OK");
          res.end(JSON.stringify(response));
        }
      } catch (e) {
        debugAndPrintError(e);
        writeError(res, {
          code: e.code || ErrorCode.MATCHMAKE_UNHANDLED,
          error: e.message
        });
      }
    });
  }
  readJson(res, cb) {
    let buffer;
    res.onData((ab, isLast) => {
      let chunk = Buffer.from(ab);
      if (isLast) {
        let json;
        if (buffer) {
          try {
            json = JSON.parse(Buffer.concat([buffer, chunk]));
          } catch (e) {
            cb(void 0);
            return;
          }
          cb(json);
        } else {
          try {
            json = JSON.parse(chunk);
          } catch (e) {
            cb(void 0);
            return;
          }
          cb(json);
        }
      } else {
        if (buffer) {
          buffer = Buffer.concat([buffer, chunk]);
        } else {
          buffer = Buffer.concat([chunk]);
        }
      }
    });
  }
}
export {
  uWebSocketsTransport
};
