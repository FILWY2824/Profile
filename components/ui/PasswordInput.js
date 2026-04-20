'use client';
import { useState, useId, forwardRef } from 'react';

/**
 * PasswordInput —— 带"显示/隐藏密码"按钮的输入框
 * ---------------------------------------------------------------------------
 * 用法:
 *   <PasswordInput value={pw} onChange={e=>setPw(e.target.value)} placeholder="..." />
 *
 * 行为:
 *   • 默认 type="password",点击右侧眼睛图标切换到 text
 *   • 额外 props(required / autoFocus / maxLength / name / autoComplete / id 等)
 *     都会透传给 <input>
 *   • 支持 ref 透传 —— 在有些场景(如表单校验)需要拿到原生元素
 *   • autoComplete 默认 'current-password',注册/重置密码时传 'new-password' 覆盖
 *
 * 样式依赖 globals.css 里的 .qs-pw-wrap / .qs-pw-input / .qs-pw-toggle
 */

const EyeIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
       stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

const EyeOffIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
       stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.44 19.44 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a19.48 19.48 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);

const PasswordInput = forwardRef(function PasswordInput(
  { value, onChange, placeholder, required, autoFocus, autoComplete = 'current-password',
    className = 'form-input', name, id, disabled, maxLength, inputMode, minLength, ...rest },
  ref
) {
  const [visible, setVisible] = useState(false);
  const autoId = useId();
  const inputId = id || autoId;

  return (
    <div className="qs-pw-wrap">
      <input
        ref={ref}
        id={inputId}
        name={name}
        type={visible ? 'text' : 'password'}
        className={`${className} qs-pw-input`}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        disabled={disabled}
        maxLength={maxLength}
        minLength={minLength}
        inputMode={inputMode}
        // 避免浏览器"记住密码"弹窗挡住眼睛按钮的 hit area
        {...rest}
      />
      <button
        type="button"
        className="qs-pw-toggle"
        onClick={() => setVisible(v => !v)}
        aria-label={visible ? '隐藏密码' : '显示密码'}
        aria-pressed={visible}
        tabIndex={-1}  // 不抢 tab 顺序,密码输入后 Enter 就能提交
        disabled={disabled}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
});

export default PasswordInput;
