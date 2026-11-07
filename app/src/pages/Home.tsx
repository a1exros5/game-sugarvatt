import { useEffect, useRef } from 'react'
import { startGame, stopGame } from '@/game/boot'

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    startGame(canvas)
    return () => stopGame()
  }, [])

  return (
    <div id="game-root">
      <canvas id="game-canvas" ref={canvasRef} aria-label="Сахарная вата: Все на сцену!" />
      <div id="ui-overlay">
        <button id="button-mute" className="pixel-icon-button" type="button" aria-label="Включить или выключить звук">♪</button>
        <button id="button-pause" className="pixel-icon-button" type="button" aria-label="Пауза" hidden>Ⅱ</button>

        <div id="game-controls" hidden>
          <div id="pixel-joystick" role="application" aria-label="Джойстик движения">
            <div className="joystick-shell">
              <div className="dpad-arm dpad-horizontal" />
              <div className="dpad-arm dpad-vertical" />
              <div className="dpad-center" />
              <span className="dpad-arrow dpad-up">▲</span>
              <span className="dpad-arrow dpad-down">▼</span>
              <span className="dpad-arrow dpad-left">◀</span>
              <span className="dpad-arrow dpad-right">▶</span>
            </div>
          </div>
          <div id="action-buttons">
            <button id="button-b" className="pixel-action-button button-b" type="button" aria-label="Музыкальная способность"><strong>B</strong><small>РИФФ</small></button>
            <button id="button-a" className="pixel-action-button button-a" type="button" aria-label="Взаимодействие"><strong>A</strong><small>ДЕЙСТВИЕ</small></button>
          </div>
        </div>

        <div id="concert-controls" hidden>
          {[0, 1, 2, 3].map((lane) => (
            <button key={lane} id={`lane-${lane}`} className={`concert-lane lane-${lane}`} type="button" aria-label={`Дорожка ${lane + 1}`}>{lane + 1}</button>
          ))}
        </div>
      </div>
      <div id="rotate-notice">
        <div className="rotate-phone">↻</div>
        <strong>ПОВЕРНИ ТЕЛЕФОН</strong>
        <span>В альбомной ориентации будет удобнее играть</span>
      </div>
    </div>
  )
}
