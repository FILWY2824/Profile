'use client';
/**
 * DateFilter —— 通用日期筛选器
 * ---------------------------------------------------------------------------
 * 替代原来"最近 14 天"下拉列表。设计目标:
 *   · 年/月/日 三级钻取,用户能快速跳到任意有记录的月份
 *   · 没有记录的日期不可选(根据后端返回的 availableDates 判定)
 *   · 4 种筛选模式:
 *       - all    全部日期(不传 from/to)
 *       - day    某一天(from === to === 当天)
 *       - since  自某日至今(只传 from)
 *       - range  日期区间(from 与 to 都传)
 *
 * 受控组件。外部传入:
 *   value = { mode, from, to }       date 以 'YYYY-MM-DD' 表示
 *   onChange(newValue)
 *   availableDates = Set<'YYYY-MM-DD'>  后端已有记录的所有日期,用于 disable
 *
 * Apply-on-commit 语义:在弹窗里改 mode / 选日期,不会立刻触发 onChange,
 * 点「应用」才真正提交。避免每次调整都走一次网络。
 * ---------------------------------------------------------------------------
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import styles from '@/app/admin/admin.module.css';
import { todayShanghai } from '@/lib/time.js';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']; // 周一起点

// ── 纯函数工具 ──────────────────────────────────────────────────────────────
function pad2(n) { return String(n).padStart(2, '0'); }
function fromIso(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
// 今天 —— 上海时区的日历日期
function todayIso() { return todayShanghai(); }

/** 返回以周一起点的 1..7 列索引 */
function weekdayMonFirst(date) {
  const d = date.getDay(); // 0=Sun
  return d === 0 ? 7 : d;
}

function daysInMonth(year, month /* 0-indexed */) {
  return new Date(year, month + 1, 0).getDate();
}

function cmpIso(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// ── 人话描述当前 value ─────────────────────────────────────────────────────
function describe(value) {
  if (!value || value.mode === 'all') return '全部日期';
  if (value.mode === 'day' && value.from)   return value.from;
  if (value.mode === 'since' && value.from) return `自 ${value.from} 至今`;
  if (value.mode === 'range' && value.from && value.to) {
    return `${value.from} ~ ${value.to}`;
  }
  if (value.mode === 'range' && value.from) return `${value.from} ~ 选择结束`;
  return '全部日期';
}

// ── 主组件 ──────────────────────────────────────────────────────────────────
export default function DateFilter({
  value,
  onChange,
  availableDates, // Set<string> | string[] | null
  placeholder = '全部日期',
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // availableDates 可能是数组,规范化为 Set
  const available = useMemo(() => {
    if (!availableDates) return null; // null → 不做可用性校验,所有日期都可选
    if (availableDates instanceof Set) return availableDates;
    return new Set(availableDates);
  }, [availableDates]);

  // 本地草稿 —— 只有「应用」才真正提交出去
  const [draft, setDraft] = useState(() => normalize(value));
  useEffect(() => {
    // 外部 value 变化时,如果弹窗关着就同步;开着就保留草稿
    if (!open) setDraft(normalize(value));
  }, [value, open]);

  // 弹窗外点击关闭
  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setDraft(normalize(value)); // 丢弃未提交的改动
      }
    }
    function onEsc(e) {
      if (e.key === 'Escape') {
        setOpen(false);
        setDraft(normalize(value));
      }
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open, value]);

  function apply(next) {
    onChange?.(next);
    setOpen(false);
  }

  function reset() {
    const cleared = { mode: 'all', from: null, to: null };
    setDraft(cleared);
    apply(cleared);
  }

  const label = describe(value) || placeholder;
  const isAll = !value || value.mode === 'all' || (!value.from && !value.to);

  return (
    <div className={styles.dfWrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.dfTrigger} ${open ? styles.dfOpen : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className={styles.dfTriggerLabel}>日期</span>
        <span className={`${styles.dfTriggerValue} ${isAll ? styles.dfTriggerValuePlaceholder : ''}`}>
          {label}
        </span>
        <span className={styles.dfTriggerCaret}>▾</span>
      </button>

      {open && (
        <DatePopover
          draft={draft}
          setDraft={setDraft}
          available={available}
          onApply={() => apply(normalize(draft))}
          onReset={reset}
          onCancel={() => { setOpen(false); setDraft(normalize(value)); }}
        />
      )}
    </div>
  );
}

// 把外部传入的 value 规整化,保证 { mode, from, to } 始终有值
function normalize(v) {
  if (!v) return { mode: 'all', from: null, to: null };
  const mode = v.mode || 'all';
  let from = v.from || null;
  let to = v.to || null;
  // day 模式强制 to = from,避免不一致
  if (mode === 'day') to = from;
  // range 且 from > to 时交换
  if (mode === 'range' && from && to && cmpIso(from, to) > 0) {
    [from, to] = [to, from];
  }
  return { mode, from, to };
}

// ── 弹窗:模式切换 + 日历 + 底部操作 ─────────────────────────────────────────
function DatePopover({ draft, setDraft, available, onApply, onReset, onCancel }) {
  // 视图面板:'day' | 'month' | 'year'
  const [panel, setPanel] = useState('day');

  // 光标年月(用来决定日历显示的月份)
  const anchorIso = draft.from || draft.to || todayIso();
  const anchorDate = fromIso(anchorIso) || new Date();
  const [viewYear, setViewYear] = useState(anchorDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(anchorDate.getMonth()); // 0-11

  // range 第二次点击用:'start' / 'end'
  const [rangePhase, setRangePhase] = useState(
    draft.mode === 'range' && draft.from && !draft.to ? 'end' : 'start'
  );

  // 有记录的年份 / 月份集合(从 available 推导)
  const { yearsWithData, monthsWithDataByYear } = useMemo(() => {
    const yrs = new Set();
    const byYear = new Map();
    if (available) {
      for (const iso of available) {
        const y = Number(iso.slice(0, 4));
        const m = Number(iso.slice(5, 7)) - 1;
        yrs.add(y);
        if (!byYear.has(y)) byYear.set(y, new Set());
        byYear.get(y).add(m);
      }
    }
    return { yearsWithData: yrs, monthsWithDataByYear: byYear };
  }, [available]);

  function setMode(nextMode) {
    setDraft(d => {
      if (nextMode === 'all')   return { mode: 'all', from: null, to: null };
      if (nextMode === 'day')   return { mode: 'day', from: d.from || null, to: d.from || null };
      if (nextMode === 'since') return { mode: 'since', from: d.from || null, to: null };
      if (nextMode === 'range') return { mode: 'range', from: d.from || null, to: d.to || null };
      return d;
    });
    if (nextMode === 'range') setRangePhase('start');
  }

  function handleDayClick(iso) {
    setDraft(d => {
      if (d.mode === 'all') return { mode: 'day', from: iso, to: iso };
      if (d.mode === 'day')   return { ...d, from: iso, to: iso };
      if (d.mode === 'since') return { ...d, from: iso, to: null };
      if (d.mode === 'range') {
        if (rangePhase === 'start') {
          setRangePhase('end');
          return { ...d, from: iso, to: null };
        }
        // phase == 'end'
        let from = d.from, to = iso;
        if (from && cmpIso(to, from) < 0) { [from, to] = [to, from]; }
        setRangePhase('start');
        return { ...d, from, to };
      }
      return d;
    });
  }

  function gotoPrevMonth() {
    let y = viewYear, m = viewMonth - 1;
    if (m < 0) { m = 11; y -= 1; }
    setViewYear(y); setViewMonth(m);
  }
  function gotoNextMonth() {
    let y = viewYear, m = viewMonth + 1;
    if (m > 11) { m = 0; y += 1; }
    setViewYear(y); setViewMonth(m);
  }

  // 月份内最早 / 最晚有记录的日期 —— 用于判断上/下月是否可点
  // 简化处理:总是允许跳转;但若完全没有 available 数据,也允许(比如初始状态)
  const canGoPrev = true;
  const canGoNext = true;

  const dayCount = daysInMonth(viewYear, viewMonth);
  const firstWeekdayCol = weekdayMonFirst(new Date(viewYear, viewMonth, 1));

  // 构建格子:前面空白 + 1..dayCount
  const cells = [];
  for (let i = 1; i < firstWeekdayCol; i++) cells.push(null);
  for (let d = 1; d <= dayCount; d++) cells.push(d);

  // 选中 / range 判定
  const isSelected = (iso) => {
    if (draft.mode === 'day') return iso === draft.from;
    if (draft.mode === 'since') return iso === draft.from;
    if (draft.mode === 'range') return iso === draft.from || iso === draft.to;
    return false;
  };
  const isRangeStart = (iso) => draft.mode === 'range' && iso === draft.from && draft.to && draft.from !== draft.to;
  const isRangeEnd   = (iso) => draft.mode === 'range' && iso === draft.to   && draft.from && draft.from !== draft.to;
  const isInRange = (iso) => {
    if (draft.mode !== 'range' || !draft.from || !draft.to) return false;
    return cmpIso(iso, draft.from) > 0 && cmpIso(iso, draft.to) < 0;
  };

  const today = todayIso();

  // 底部状态提示
  let statusText;
  if (draft.mode === 'all') statusText = '不做日期过滤';
  else if (draft.mode === 'day') statusText = draft.from || '请选择一天';
  else if (draft.mode === 'since') statusText = draft.from ? `自 ${draft.from} 至今` : '请选择起始日期';
  else if (draft.mode === 'range') {
    if (draft.from && draft.to) statusText = `${draft.from} ~ ${draft.to}`;
    else if (draft.from) statusText = `${draft.from} ~ 选择结束日期`;
    else statusText = '选择起始日期';
  }

  return (
    <div
      className={styles.dfPopover}
      role="dialog"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 模式切换 */}
      <div className={styles.dfModes}>
        {[
          ['all',   '全部'],
          ['day',   '某一天'],
          ['since', '至今'],
          ['range', '区间'],
        ].map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`${styles.dfModeBtn} ${draft.mode === k ? styles.dfModeBtnActive : ''}`}
            onClick={() => setMode(k)}
          >{label}</button>
        ))}
      </div>

      {/* 当模式是 "全部" 时不显示日历,直接留个说明 */}
      {draft.mode === 'all' ? (
        <div className={styles.dfEmpty}>
          已选中「全部日期」,点下方「应用」确认。
        </div>
      ) : (
        <>
          {/* 年月导航 */}
          <div className={styles.dfMonthNav}>
            <button
              type="button"
              className={styles.dfNavBtn}
              onClick={gotoPrevMonth}
              disabled={!canGoPrev}
              aria-label="上一月"
            >‹</button>

            <div className={styles.dfNavCenter}>
              <button
                type="button"
                className={`${styles.dfNavYM} ${panel === 'year' ? styles.dfNavYMActive : ''}`}
                onClick={() => setPanel(panel === 'year' ? 'day' : 'year')}
              >{viewYear} 年</button>
              <button
                type="button"
                className={`${styles.dfNavYM} ${panel === 'month' ? styles.dfNavYMActive : ''}`}
                onClick={() => setPanel(panel === 'month' ? 'day' : 'month')}
              >{viewMonth + 1} 月</button>
            </div>

            <button
              type="button"
              className={styles.dfNavBtn}
              onClick={gotoNextMonth}
              disabled={!canGoNext}
              aria-label="下一月"
            >›</button>
          </div>

          {/* 子面板:年份网格 */}
          {panel === 'year' && (
            <YearGrid
              year={viewYear}
              yearsWithData={yearsWithData}
              hasConstraint={!!available}
              onPick={(y) => { setViewYear(y); setPanel('month'); }}
            />
          )}

          {/* 子面板:月份网格 */}
          {panel === 'month' && (
            <MonthGrid
              viewMonth={viewMonth}
              monthsWithData={monthsWithDataByYear.get(viewYear) || new Set()}
              hasConstraint={!!available}
              onPick={(m) => { setViewMonth(m); setPanel('day'); }}
            />
          )}

          {/* 子面板:日期网格 */}
          {panel === 'day' && (
            <>
              <div className={styles.dfWeekRow}>
                {WEEKDAYS.map(w => (
                  <div key={w} className={styles.dfWeekCell}>{w}</div>
                ))}
              </div>
              <div className={styles.dfDays}>
                {cells.map((d, i) => {
                  if (d === null) {
                    return <span key={`e-${i}`} className={`${styles.dfDay} ${styles.dfDayEmpty}`} />;
                  }
                  const iso = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(d)}`;
                  const disabled = available ? !available.has(iso) : false;
                  const selected = isSelected(iso);
                  const inRange = isInRange(iso);
                  const rangeStart = isRangeStart(iso);
                  const rangeEnd   = isRangeEnd(iso);

                  const cls = [
                    styles.dfDay,
                    disabled && styles.dfDayDisabled,
                    iso === today && styles.dfDayToday,
                    selected && styles.dfDaySelected,
                    inRange && styles.dfDayInRange,
                    rangeStart && styles.dfDayRangeStart,
                    rangeEnd && styles.dfDayRangeEndPos,
                  ].filter(Boolean).join(' ');

                  return (
                    <button
                      key={iso}
                      type="button"
                      className={cls}
                      disabled={disabled}
                      onClick={() => handleDayClick(iso)}
                    >{d}</button>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* 底部 */}
      <div className={styles.dfFooter}>
        <div className={styles.dfStatus}>
          {draft.mode === 'range' && !draft.to ? (
            <span className={styles.dfStatusHint}>{statusText}</span>
          ) : (
            <span>{statusText}</span>
          )}
        </div>
        <div className={styles.dfActions}>
          <button className="btn btn-ghost btn-sm" type="button" onClick={onReset}>清除</button>
          <button className="btn btn-outline btn-sm" type="button" onClick={onCancel}>取消</button>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={onApply}
            disabled={
              (draft.mode === 'day'   && !draft.from) ||
              (draft.mode === 'since' && !draft.from) ||
              (draft.mode === 'range' && (!draft.from || !draft.to))
            }
          >应用</button>
        </div>
      </div>
    </div>
  );
}

// ── 年份网格 ────────────────────────────────────────────────────────────────
function YearGrid({ year, yearsWithData, hasConstraint, onPick }) {
  // 展示 [year-6, year+5] 的年份
  const start = year - 6;
  const items = Array.from({ length: 12 }, (_, i) => start + i);
  return (
    <div className={`${styles.dfGrid} ${styles.dfYearGrid}`}>
      {items.map(y => {
        const disabled = hasConstraint && !yearsWithData.has(y);
        const active = y === year;
        return (
          <button
            key={y}
            type="button"
            className={[
              styles.dfGridCell,
              disabled && styles.dfGridCellDisabled,
              active && styles.dfGridCellActive,
            ].filter(Boolean).join(' ')}
            disabled={disabled}
            onClick={() => onPick(y)}
          >{y}</button>
        );
      })}
    </div>
  );
}

// ── 月份网格 ────────────────────────────────────────────────────────────────
function MonthGrid({ viewMonth, monthsWithData, hasConstraint, onPick }) {
  const items = Array.from({ length: 12 }, (_, i) => i);
  return (
    <div className={`${styles.dfGrid} ${styles.dfMonthGrid}`}>
      {items.map(m => {
        const disabled = hasConstraint && !monthsWithData.has(m);
        const active = m === viewMonth;
        return (
          <button
            key={m}
            type="button"
            className={[
              styles.dfGridCell,
              disabled && styles.dfGridCellDisabled,
              active && styles.dfGridCellActive,
            ].filter(Boolean).join(' ')}
            disabled={disabled}
            onClick={() => onPick(m)}
          >{m + 1} 月</button>
        );
      })}
    </div>
  );
}
