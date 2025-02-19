var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var uWebSocketsTransport_exports = {};
__export(uWebSocketsTransport_exports, {
  uWebSocketsTransport: () => uWebSocketsTransport
});
module.exports = __toCommonJS(uWebSocketsTransport_exports);
var import_querystring = __toESM(require("querystring"));
var import_uWebSockets = __toESM(require("uWebSockets.js"));
var import_core = require("@colyseus/core");
var import_uWebSocketClient = require("./uWebSocketClient");
class uWebSocketsTransport extends import_core.Transport {
  constructor(options = {}, appOptions = {}) {
    super();
    this.clients = [];
    this.clientWrappers = /* @__PURE__ */ new WeakMap();
    this._originalRawSend = null;
    this.app = appOptions.cert_file_name && appOptions.key_file_name ? import_uWebSockets.default.SSLApp(appOptions) : import_uWebSockets.default.App(appOptions);
    if (options.maxBackpressure === void 0) {
      options.maxBackpressure = 1024 * 1024;
    }
    if (options.compression === void 0) {
      options.compression = import_uWebSockets.default.DISABLED;
    }
    if (options.maxPayloadLength === void 0) {
      options.maxPayloadLength = 4 * 1024;
    }
    if (options.sendPingsAutomatically === void 0) {
      options.sendPingsAutomatically = true;
    }
    if (!this.server) {
      this.server = new import_core.DummyServer();
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
        (0, import_core.spliceOne)(this.clients, this.clients.indexOf(ws));
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
      import_uWebSockets.default.us_listen_socket_close(this._listeningSocket);
      this.server.emit("close");
    }
  }
  simulateLatency(milliseconds) {
    if (this._originalRawSend == null) {
      this._originalRawSend = import_uWebSocketClient.uWebSocketClient.prototype.raw;
    }
    const originalRawSend = this._originalRawSend;
    import_uWebSocketClient.uWebSocketClient.prototype.raw = milliseconds <= Number.EPSILON ? originalRawSend : function() {
      setTimeout(() => originalRawSend.apply(this, arguments), milliseconds);
    };
  }
  async onConnection(rawClient) {
    const wrapper = new import_uWebSocketClient.uWebSocketWrapper(rawClient);
    this.clients.push(rawClient);
    this.clientWrappers.set(rawClient, wrapper);
    const query = rawClient.query;
    const url = rawClient.url;
    const searchParams = import_querystring.default.parse(query);
    const sessionId = searchParams.sessionId;
    const processAndRoomId = url.match(/\/[a-zA-Z0-9_\-]+\/([a-zA-Z0-9_\-]+)$/);
    const roomId = processAndRoomId && processAndRoomId[1];
    const room = import_core.matchMaker.getRoomById(roomId);
    const client = new import_uWebSocketClient.uWebSocketClient(sessionId, wrapper);
    try {
      if (!room || !room.hasReservedSeat(sessionId, searchParams.reconnectionToken)) {
        throw new Error("seat reservation expired.");
      }
      await room._onJoin(client, rawClient);
    } catch (e) {
      (0, import_core.debugAndPrintError)(e);
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
        import_core.matchMaker.controller.DEFAULT_CORS_HEADERS,
        import_core.matchMaker.controller.getCorsHeaders.call(void 0, req)
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
      if (import_core.matchMaker.isGracefullyShuttingDown) {
        return res.close();
      }
      writeHeaders(req, res);
      res.writeHeader("Content-Type", "application/json");
      const url = req.getUrl();
      const matchedParams = url.match(allowedRoomNameChars);
      const matchmakeIndex = matchedParams.indexOf(matchmakeRoute);
      const authToken = (0, import_core.getBearerToken)(req.getHeader("authorization"));
      const headers = {};
      req.forEach((key, value) => headers[key] = value);
      this.readJson(res, async (clientOptions) => {
        try {
          if (clientOptions === void 0) {
            throw new Error("invalid JSON input");
          }
          const method = matchedParams[matchmakeIndex + 1];
          const roomName = matchedParams[matchmakeIndex + 2] || "";
          const response = await import_core.matchMaker.controller.invokeMethod(
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
          (0, import_core.debugAndPrintError)(e);
          writeError(res, {
            code: e.code || import_core.ErrorCode.MATCHMAKE_UNHANDLED,
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
        const response = await import_core.matchMaker.controller.getAvailableRooms(roomName || "");
        if (!res.aborted) {
          res.writeStatus("200 OK");
          res.end(JSON.stringify(response));
        }
      } catch (e) {
        (0, import_core.debugAndPrintError)(e);
        writeError(res, {
          code: e.code || import_core.ErrorCode.MATCHMAKE_UNHANDLED,
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  uWebSocketsTransport
});
