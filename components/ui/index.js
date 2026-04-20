'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// ─── Spinner ───────────────────────────────────────────────────────────────
export function Spinner({ dark = false }) {
  return <span className={`spinner ${dark ? 'spinner-dark' : ''}`} />;
}

// ─── Alert (inline message) ────────────────────────────────────────────────
export function Alert({ type = 'error', children }) {
  const icons = { error: '✕', success: '✓', info: 'ℹ', warning: '⚠' };
  return (
    <div className={`alert alert-${type}`}>
      <span style={{ flexShrink: 0, fontWeight: 600 }}>{icons[type]}</span>
      <span>{children}</span>
    </div>
  );
}

// ─── Modal ─────────────────────────────────────────────────────────────────
// Portal-rendered. ESC to close. Overlay click to close.
export function Modal({ title, onClose, children, footer, size = 'sm' }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    window.addEventListener('keydown', onKey);
    // prevent body scroll while open
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  if (!mounted) return null;
  const maxWidth = size === 'lg' ? 640 : size === 'md' ? 520 : 440;
  return createPortal(
    <div className="qs-modal-overlay" onClick={e => e.target === e.currentTarget && onClose?.()}>
      <div className="qs-modal" style={{ maxWidth }} role="dialog" aria-modal="true">
        <div className="qs-modal-header">
          <h2 className="qs-modal-title">{title}</h2>
          <button
            className="qs-modal-close"
            onClick={onClose}
            aria-label="关闭"
            type="button"
          >✕</button>
        </div>
        <div className="qs-modal-body">{children}</div>
        {footer && <div className="qs-modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

// ─── Confirm Dialog (replaces all native window.confirm) ───────────────────
export function ConfirmDialog({
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  confirmClass = 'btn-danger',
  tone = 'danger', // 'danger' | 'primary' | 'warning'
  onConfirm,
  onClose,
  loading,
}) {
  return (
    <Modal title={title} onClose={onClose} footer={
      <>
        <button className="btn btn-outline" onClick={onClose} disabled={loading} type="button">
          {cancelText}
        </button>
        <button className={`btn ${confirmClass}`} onClick={onConfirm} disabled={loading} type="button">
          {loading ? <Spinner /> : confirmText}
        </button>
      </>
    }>
      <div className={`qs-confirm-body qs-tone-${tone}`}>
        <div className="qs-confirm-icon">
          {tone === 'danger' ? '⚠' : tone === 'warning' ? '!' : '?'}
        </div>
        <div className="qs-confirm-msg">{message}</div>
      </div>
    </Modal>
  );
}

// ─── Pagination ────────────────────────────────────────────────────────────
export function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 2 && i <= page + 2)) pages.push(i);
    else if (pages[pages.length - 1] !== '...') pages.push('...');
  }
  return (
    <div className="pagination">
      <button className="page-btn" disabled={page <= 1} onClick={() => onChange(page - 1)}>‹</button>
      {pages.map((p, i) =>
        p === '...' ? <span key={i} style={{ padding: '6px 4px', color: 'var(--ink-3)', fontSize: '0.85rem' }}>…</span>
        : <button key={p} className={`page-btn ${page === p ? 'active' : ''}`} onClick={() => onChange(p)}>{p}</button>
      )}
      <button className="page-btn" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>›</button>
    </div>
  );
}

// ─── Badge ─────────────────────────────────────────────────────────────────
export function Badge({ children, type = 'gray' }) {
  return <span className={`badge badge-${type}`}>{children}</span>;
}

// ─── Form Field ────────────────────────────────────────────────────────────
export function Field({ label, hint, error, children }) {
  return (
    <div className="form-group">
      {label && <label className="form-label">{label}</label>}
      {children}
      {hint && !error && <span className="form-hint">{hint}</span>}
      {error && <span className="form-error">{error}</span>}
    </div>
  );
}

// ─── Empty State ───────────────────────────────────────────────────────────
export function EmptyState({ icon = '📭', title, desc, action }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      {title && <div className="empty-state-title">{title}</div>}
      {desc && <div className="empty-state-desc">{desc}</div>}
      {action}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Toast — global non-blocking notifications
// ═══════════════════════════════════════════════════════════════════════════
//
//  Usage:
//    const toast = useToast();
//    toast.success('保存成功');
//    toast.error('网络错误');
//    toast.info('提示');
//    toast.warning('注意');
//
//  All errors in the app should flow through toast.error(...) per requirements.
//
//  Implementation notes:
//    - Toasts auto-dismiss after `duration` ms (default 3500, errors 5000)
//    - Each toast has its own setTimeout; cleared on unmount or manual close,
//      so there's no memory leak even if the page navigates.
//    - ToastProvider wraps the whole app in app/layout.js.
//

const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Graceful fallback: if ToastProvider isn't mounted yet (SSR / first render),
    // log to console instead of throwing — keeps the page functional.
    return {
      success: (m) => console.log('[toast][success]', m),
      error:   (m) => console.error('[toast][error]', m),
      info:    (m) => console.log('[toast][info]', m),
      warning: (m) => console.warn('[toast][warning]', m),
      show:    (m) => console.log('[toast]', m),
      dismiss: () => {},
    };
  }
  return ctx;
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  // Track active timers so we can clear them all on unmount
  const timersRef = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts(list => list.filter(t => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) { clearTimeout(timer); timersRef.current.delete(id); }
  }, []);

  const show = useCallback((message, { type = 'info', duration } = {}) => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ms = duration ?? (type === 'error' ? 5000 : 3500);
    setToasts(list => [...list, { id, message, type }]);
    const timer = setTimeout(() => dismiss(id), ms);
    timersRef.current.set(id, timer);
    return id;
  }, [dismiss]);

  // Cleanup all pending timers on provider unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  // api 用 useMemo 锁定身份 —— 这个对象会作为 context value 传下去,
  // 如果每次 render 都新建,所有 `const toast = useToast()` 的组件里把 toast
  // 放进 useCallback / useEffect deps 的地方就会每次 render 都失效 ——
  // 一旦 toast.error 触发 Provider 重渲染,下游就陷入死循环。已经踩过坑了:
  // 数据库浏览器页的 loadRows deps=[overview, toast],toast 一变就重跑,
  // 加上 404 的 retry,请求量瞬间上千条(参见 commit 修复 favicon_cache 白名单)。
  const api = useMemo(() => ({
    show,
    dismiss,
    success: (m, opts) => show(m, { ...opts, type: 'success' }),
    error:   (m, opts) => show(m, { ...opts, type: 'error' }),
    info:    (m, opts) => show(m, { ...opts, type: 'info' }),
    warning: (m, opts) => show(m, { ...opts, type: 'warning' }),
  }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ toasts, dismiss }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="qs-toast-viewport" aria-live="polite" aria-atomic="false">
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onClose={() => dismiss(t.id)} />
      ))}
    </div>,
    document.body
  );
}

function ToastItem({ toast, onClose }) {
  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
  return (
    <div className={`qs-toast qs-toast-${toast.type}`} role="status">
      <span className="qs-toast-icon">{icons[toast.type]}</span>
      <span className="qs-toast-msg">{toast.message}</span>
      <button className="qs-toast-close" onClick={onClose} aria-label="关闭">✕</button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Imperative ConfirmDialog helper: useConfirm()
// ═══════════════════════════════════════════════════════════════════════════
//
//  const confirm = useConfirm();
//  const ok = await confirm({ title: '删除', message: '确定?', confirmText: '删除' });
//  if (ok) doDelete();
//
//  Under the hood it mounts a ConfirmDialog and resolves a promise.
//  This is what replaces all window.confirm() in the codebase.

const ConfirmContext = createContext(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    // Fallback when provider isn't mounted: resolve as declined, log a warning.
    return async () => {
      console.warn('[useConfirm] ConfirmProvider not mounted; defaulting to cancel');
      return false;
    };
  }
  return ctx;
}

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null); // { ... props, resolve }

  const confirm = useCallback((opts) => {
    return new Promise(resolve => {
      setState({ ...opts, resolve });
    });
  }, []);

  const handleConfirm = () => { state?.resolve(true); setState(null); };
  const handleClose = () => { state?.resolve(false); setState(null); };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <ConfirmDialog
          title={state.title}
          message={state.message}
          confirmText={state.confirmText}
          cancelText={state.cancelText}
          confirmClass={state.confirmClass}
          tone={state.tone}
          onConfirm={handleConfirm}
          onClose={handleClose}
        />
      )}
    </ConfirmContext.Provider>
  );
}
