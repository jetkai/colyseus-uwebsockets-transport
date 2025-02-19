import EventEmitter from "events";
import { getMessageBytes, Protocol, ClientState, logger, debugMessage } from "@colyseus/core";
import { Schema } from "@colyseus/schema";
class uWebSocketWrapper extends EventEmitter {
  constructor(ws) {
    super();
    this.ws = ws;
  }
}
var ReadyState = /* @__PURE__ */ ((ReadyState2) => {
  ReadyState2[ReadyState2["CONNECTING"] = 0] = "CONNECTING";
  ReadyState2[ReadyState2["OPEN"] = 1] = "OPEN";
  ReadyState2[ReadyState2["CLOSING"] = 2] = "CLOSING";
  ReadyState2[ReadyState2["CLOSED"] = 3] = "CLOSED";
  return ReadyState2;
})(ReadyState || {});
class uWebSocketClient {
  constructor(id, _ref) {
    this.id = id;
    this._ref = _ref;
    this.state = ClientState.JOINING;
    this.readyState = 1 /* OPEN */;
    this._enqueuedMessages = [];
    this.sessionId = id;
    _ref.on("close", () => this.readyState = 3 /* CLOSED */);
  }
  get ref() {
    return this._ref;
  }
  set ref(_ref) {
    this._ref = _ref;
    this.readyState = 1 /* OPEN */;
  }
  sendBytes(type, bytes, options) {
    debugMessage("send bytes(to %s): '%s' -> %j", this.sessionId, type, bytes);
    this.enqueueRaw(
      getMessageBytes.raw(Protocol.ROOM_DATA_BYTES, type, void 0, bytes),
      options
    );
  }
  send(messageOrType, messageOrOptions, options) {
    debugMessage("send(to %s): '%s' -> %O", this.sessionId, messageOrType, messageOrOptions);
    this.enqueueRaw(
      messageOrType instanceof Schema ? getMessageBytes[Protocol.ROOM_DATA_SCHEMA](messageOrType) : getMessageBytes.raw(Protocol.ROOM_DATA, messageOrType, messageOrOptions),
      options
    );
  }
  enqueueRaw(data, options) {
    if (options?.afterNextPatch) {
      this._afterNextPatchQueue.push([this, arguments]);
      return;
    }
    if (this.state === ClientState.JOINING) {
      this._enqueuedMessages.push(data);
      return;
    }
    this.raw(data, options);
  }
  raw(data, options, cb) {
    if (this.readyState !== 1 /* OPEN */) {
      return;
    }
    this._ref.ws.send(new Uint8Array(data), true, false);
  }
  error(code, message = "", cb) {
    this.raw(getMessageBytes[Protocol.ERROR](code, message));
    cb();
  }
  leave(code, data) {
    if (this.readyState !== 1 /* OPEN */) {
      return;
    }
    this.readyState = 2 /* CLOSING */;
    if (code !== void 0) {
      this._ref.ws.end(code, data);
    } else {
      this._ref.ws.close();
    }
  }
  close(code, data) {
    logger.warn("DEPRECATION WARNING: use client.leave() instead of client.close()");
    try {
      throw new Error();
    } catch (e) {
      logger.info(e.stack);
    }
    this.leave(code, data);
  }
  toJSON() {
    return { sessionId: this.sessionId, readyState: this.readyState };
  }
}
export {
  ReadyState,
  uWebSocketClient,
  uWebSocketWrapper
};
