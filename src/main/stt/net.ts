// Таймаут на один сетевой вызов + отмена задачи пользователем (AbortSignal.any).
// Без таймаута зависший интернет замораживал задачу (и очередь) навсегда.
export function netSignal(ms: number, outer?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(ms)
  return outer ? AbortSignal.any([outer, t]) : t
}
