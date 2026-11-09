import { Compass, ListChecks } from 'lucide-react'
import type { TourId } from '../../../shared/types'

// Экран после мастера первого запуска: как познакомиться со «Словом».

export default function TourChoice({ onChoose }: { onChoose: (c: TourId | 'later') => void }): React.JSX.Element {
  return (
    <div className="modal-overlay tour-overlay" data-testid="tour-choice">
      <div className="modal modal-sm tour-choice" role="dialog" aria-modal="true" aria-labelledby="tour-choice-title">
        <h2 className="tour-choice-title" id="tour-choice-title">
          Как познакомиться со «Словом»?
        </h2>
        <p className="tour-choice-lead">Выберите один из двух туров. Позже его можно пройти заново.</p>
        <div className="tour-choice-opts">
          <button className="tour-opt" onClick={() => onChoose('short')} autoFocus data-testid="tour-short">
            <span className="tour-opt-ico" aria-hidden="true">
              <Compass size={20} />
            </span>
            <span className="tour-opt-text">
              <strong>Коротко</strong>
              <span>2–3 минуты по главному. Потом по две-три подсказки при первом заходе в каждый раздел.</span>
            </span>
          </button>
          <button className="tour-opt" onClick={() => onChoose('full')} data-testid="tour-full">
            <span className="tour-opt-ico" aria-hidden="true">
              <ListChecks size={20} />
            </span>
            <span className="tour-opt-text">
              <strong>Подробно</strong>
              <span>Один тур по всем функциям подряд. Я сам перехожу между страницами.</span>
            </span>
          </button>
        </div>
        <div className="tour-choice-foot">
          <button className="btn" onClick={() => onChoose('later')} data-testid="tour-later">
            Позже
          </button>
          <span className="st-hint">Вернуться можно в «Настройки» → «Общие» → «Обучение».</span>
        </div>
      </div>
    </div>
  )
}
