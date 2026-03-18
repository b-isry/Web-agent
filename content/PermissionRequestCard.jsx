import React, { useState } from 'react';

/**
 * Legibility UI - Permission Request Card
 * Shown before any write action (click, type) - explains what, why, expected outcome
 */
export function PermissionRequestCard({
  action,
  goal,
  elementLabel,
  onApprove,
  onModify,
  onReject,
}) {
  const [modifiedValue, setModifiedValue] = useState(action.value ?? '');
  const [isModifying, setIsModifying] = useState(false);

  const actionLabels = {
    click: 'Click',
    type: 'Enter text',
    scroll: 'Scroll to',
  };
  const actionLabel = actionLabels[action.action] || action.action;

  const whatText =
    action.action === 'type'
      ? `${actionLabel} into "${elementLabel}"`
      : `${actionLabel} on "${elementLabel}"`;

  const whyText = `Working toward your goal: "${goal}"`;

  const outcomeText =
    action.action === 'click'
      ? `The "${elementLabel}" button/link will be activated.`
      : action.action === 'type'
        ? `The field will be filled with the specified text.`
        : `The page will scroll to bring the element into view.`;

  const handleApprove = () => {
    if (isModifying && action.action === 'type') {
      onApprove({ ...action, value: modifiedValue });
    } else {
      onApprove(action);
    }
  };

  const handleModifyOrCancel = () => {
    if (isModifying) {
      setIsModifying(false);
    } else if (action.action === 'type') {
      setIsModifying(true);
    } else {
      onReject?.();
    }
  };

  return (
    <div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
            <svg
              className="h-5 w-5 text-amber-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-slate-800">
            Permission Request
          </h2>
        </div>

        <div className="space-y-4 text-sm">
          <div>
            <h3 className="mb-1 font-medium text-slate-600">What it wants to do</h3>
            <p className="text-slate-800">{whatText}</p>
          </div>
          <div>
            <h3 className="mb-1 font-medium text-slate-600">Why it's doing it</h3>
            <p className="text-slate-800">{whyText}</p>
          </div>
          <div>
            <h3 className="mb-1 font-medium text-slate-600">Expected outcome</h3>
            <p className="text-slate-800">{outcomeText}</p>
          </div>

          {isModifying && action.action === 'type' && (
            <div>
              <label className="mb-1 block font-medium text-slate-600">
                Modify the text to enter
              </label>
              <input
                type="text"
                value={modifiedValue}
                onChange={(e) => setModifiedValue(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="Enter new value..."
                autoFocus
              />
            </div>
          )}
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={handleApprove}
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 font-medium text-white transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
          >
            Approve
          </button>
          <button
            onClick={handleModifyOrCancel}
            className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-medium text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
          >
            {action.action === 'type' && isModifying ? 'Cancel' : 'Modify'}
          </button>
        </div>
      </div>
    </div>
  );
}

