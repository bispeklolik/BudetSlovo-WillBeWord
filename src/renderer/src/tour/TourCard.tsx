import { Compass } from 'lucide-react'
import { useTour } from './TourProvider'

// Карточка на Главной для тех, кто уже пользуется «Словом»: показывается один раз.
// Любой ответ (тур или «Не сейчас») закрывает её навсегда.

export default function TourCard(): React.JSX.Element | null {
  const { offer, choose, dismiss } = useTour()
  if (offer !== 'card') return null
  return (
    <section className="tour-card" aria-label="Обучение" data-testid="tour-card">
      <span className="tour-card-ico" aria-hidden="true">
        <Compass size={20} />
      </span>
      <div className="tour-card-main">
        <h2 className="tour-card-title">Интерфейс обновился — пройти обучение?</h2>
        <p className="tour-card-text">Покажу, где что лежит. Это займёт пару минут.</p>
        <div className="tour-card-actions">
          <button className="btn btn-sm btn-primary" onClick={() => choose('short')} data-testid="tour-card-short">
            Коротко
          </button>
          <button className="btn btn-sm" onClick={() => choose('full')} data-testid="tour-card-full">
            Подробно
          </button>
          <button className="btn btn-sm" onClick={dismiss} data-testid="tour-card-close">
            Не сейчас
          </button>
        </div>
      </div>
    </section>
  )
}
