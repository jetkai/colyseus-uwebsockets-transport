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
var uWebSocketClient_exports = {};
__export(uWebSocketClient_exports, {
  ReadyState: () => ReadyState,
  uWebSocketClient: () => uWebSocketClient,
  uWebSocketWrapper: () => uWebSocketWrapper
});
module.exports = __toCommonJS(uWebSocketClient_exports);
var import_events = __toESM(require("events"));
var import_core = require("@colyseus/core");
var import_schema = require("@colyseus/schema");
class uWebSocketWrapper extends import_events.default {
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
    this.state = import_core.ClientState.JOINING;
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
    (0, import_core.debugMessage)("send bytes(to %s): '%s' -> %j", this.sessionId, type, bytes);
    this.enqueueRaw(
      import_core.getMessageBytes.raw(import_core.Protocol.ROOM_DATA_BYTES, type, void 0, bytes),
      options
    );
  }
  send(messageOrType, messageOrOptions, options) {
    (0, import_core.debugMessage)("send(to %s): '%s' -> %O", this.sessionId, messageOrType, messageOrOptions);
    this.enqueueRaw(
      messageOrType instanceof import_schema.Schema ? import_core.getMessageBytes[import_core.Protocol.ROOM_DATA_SCHEMA](messageOrType) : import_core.getMessageBytes.raw(import_core.Protocol.ROOM_DATA, messageOrType, messageOrOptions),
      options
    );
  }
  enqueueRaw(data, options) {
    if (options?.afterNextPatch) {
      this._afterNextPatchQueue.push([this, arguments]);
      return;
    }
    if (this.state === import_core.ClientState.JOINING) {
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
    this.raw(import_core.getMessageBytes[import_core.Protocol.ERROR](code, message));
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
    import_core.logger.warn("DEPRECATION WARNING: use client.leave() instead of client.close()");
    try {
      throw new Error();
    } catch (e) {
      import_core.logger.info(e.stack);
    }
    this.leave(code, data);
  }
  toJSON() {
    return { sessionId: this.sessionId, readyState: this.readyState };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ReadyState,
  uWebSocketClient,
  uWebSocketWrapper
});
