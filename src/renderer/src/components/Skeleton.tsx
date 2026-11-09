// Серая заглушка на время загрузки (вместо пустого экрана или «Добро пожаловать»).
export function Skeleton({
  width,
  height = 16,
  radius = 8
}: {
  width?: number | string
  height?: number | string
  radius?: number
}): React.JSX.Element {
  return (
    <span
      className="skeleton"
      aria-hidden="true"
      style={{ width: width ?? '100%', height, borderRadius: radius }}
    />
  )
}
