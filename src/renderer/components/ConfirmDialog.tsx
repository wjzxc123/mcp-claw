import React from 'react';

interface ConfirmDialogProps {
  title: string;
  message: React.ReactNode;
  detail?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  detail,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.ReactElement {
  return (
    <div className="modal-overlay" onClick={busy ? undefined : onCancel}>
      <div className="modal-box confirm-dialog" onClick={e => e.stopPropagation()}>
        <div className="modal-header">{title}</div>
        <div className="modal-body">
          <div className="confirm-message">{message}</div>
          {detail && <div className="confirm-detail">{detail}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onCancel} disabled={busy}>
            {cancelText}
          </button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? '处理中...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
