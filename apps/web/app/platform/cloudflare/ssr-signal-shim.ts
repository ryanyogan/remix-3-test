// During server rendering, remix/component hands components a frozen stand-in for handle.signal
// that never aborts. Node's addEventListener accepts any signal-shaped object, but workerd requires
// a real AbortSignal and throws, so components that subscribe in setup fail to render. Listeners
// tied to a signal that never aborts behave the same without it, so drop non-AbortSignal signals.
const addEventListener = EventTarget.prototype.addEventListener

EventTarget.prototype.addEventListener = function (type, listener, options) {
  if (typeof options === 'object' && options?.signal && !(options.signal instanceof AbortSignal)) {
    let { signal: _, ...rest } = options
    options = rest
  }
  return addEventListener.call(this, type, listener, options)
}
