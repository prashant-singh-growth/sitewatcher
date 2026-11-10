'use client';
import { useState, useEffect } from 'react';
import { Btn, Icon } from './kit';
import { TOURS, type TourStep, type WalkthroughTour } from '../../modules/docs/tours-data';

export type { TourStep, WalkthroughTour };
export { TOURS };

export function WalkthroughTrigger({ tourId }: { tourId: string }) {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const tour = TOURS[tourId];

  useEffect(() => {
    if (!active || !tour) return;
    const currentStep = tour.steps[stepIndex];
    if (currentStep?.target) {
      const el = document.querySelector(currentStep.target);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('sw-tour-highlight');
      }
    }
    return () => {
      document.querySelectorAll('.sw-tour-highlight').forEach(el => el.classList.remove('sw-tour-highlight'));
    };
  }, [active, stepIndex, tour]);

  if (!tour) return null;

  const currentStep = tour.steps[stepIndex];

  return (
    <>
      <button
        className="sw-btn ghost small"
        onClick={() => {
          setStepIndex(0);
          setActive(true);
        }}
        title={`Take interactive tour of ${tour.name}`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 10px' }}
      >
        <Icon name="play" size={13} />
        <span>Tour Guide</span>
      </button>

      {active && currentStep && (
        <div
          className="sw-tour-modal-overlay"
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 9999,
            maxWidth: 420,
            background: 'var(--card-bg, #ffffff)',
            border: '1px solid var(--line, #e2e8f0)',
            borderRadius: 10,
            boxShadow: '0 12px 30px rgba(0,0,0,0.18)',
            padding: 20
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <div>
              <span className="sw-badge blue" style={{ fontSize: 11, marginBottom: 4, display: 'inline-block' }}>
                Step {stepIndex + 1} of {tour.steps.length}
              </span>
              <h3 style={{ margin: 0, fontSize: 16 }}>{currentStep.title}</h3>
            </div>
            <button
              onClick={() => setActive(false)}
              className="sw-icon-btn"
              style={{ minWidth: 28, height: 28 }}
              aria-label="Close tour"
            >
              <Icon name="x" size={14} />
            </button>
          </div>

          <p style={{ fontSize: 13, color: 'var(--muted, #64748b)', lineHeight: 1.5, margin: '8px 0 16px' }}>
            {currentStep.description}
          </p>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              className="text-btn"
              onClick={() => setActive(false)}
              style={{ fontSize: 12, color: 'var(--muted)' }}
            >
              Skip tour
            </button>

            <div style={{ display: 'flex', gap: 8 }}>
              {stepIndex > 0 && (
                <Btn
                  kind="ghost"
                  style={{ fontSize: 12, padding: '4px 12px' }}
                  onClick={() => setStepIndex(i => i - 1)}
                >
                  Back
                </Btn>
              )}

              {stepIndex < tour.steps.length - 1 ? (
                <Btn
                  style={{ fontSize: 12, padding: '4px 14px' }}
                  onClick={() => setStepIndex(i => i + 1)}
                >
                  Next →
                </Btn>
              ) : (
                <Btn
                  style={{ fontSize: 12, padding: '4px 14px' }}
                  onClick={() => setActive(false)}
                >
                  ✓ Finish
                </Btn>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
