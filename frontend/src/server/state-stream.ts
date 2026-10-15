export function createStateStream(signal: AbortSignal, produce: () => Promise<unknown>, periodMs = 1000): ReadableStream<Uint8Array> {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  const encoder = new TextEncoder()
  const stop = () => { stopped = true; if (timer) clearTimeout(timer); if (abort) signal.removeEventListener('abort', abort) }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      abort = () => { if (!stopped) { stop(); controller.close() } }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) { abort(); return }
      const send = async () => {
        try {
          const snapshot = await produce()
          if (!stopped) controller.enqueue(encoder.encode('event: snapshot\ndata: ' + JSON.stringify(snapshot) + '\n\n'))
        } catch {
          if (!stopped) controller.enqueue(encoder.encode('event: stream_error\ndata: {"message":"Состояние временно недоступно; повторяем подключение"}\n\n'))
        } finally { if (!stopped) timer = setTimeout(() => void send(), periodMs) }
      }
      void send()
    },
    cancel: stop,
  })
}
