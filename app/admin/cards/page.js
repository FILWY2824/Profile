'use client';
import { useEffect, useState, useCallback } from 'react';
import { Spinner, Modal, Pagination, EmptyState, Badge, useToast, useConfirm } from '@/components/ui/index.js';
import styles from '../admin.module.css';

const EMPTY_FORM = { title: '', description: '', url: '', sectionId: '', order: '', permission: 'public' };

const PERM_LABELS = {
  public: { label: '公开访问',   type: 'green'  },
  user:   { label: '需登录',     type: 'blue'   },
  member: { label: '仅会员',     type: 'violet' },
  admin:  { label: '仅管理员',   type: 'red'    },
};

export default function AdminCards() {
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [sections, setSections] = useState([]);
  const [search, setSearch] = useState('');
  const [filterSection, setFilterSection] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const loadSections = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/sections');
      if (!res.ok) throw new Error();
      const d = await res.json();
      setSections(d.sections || []);
    } catch { toast.error('加载板块失败'); }
  }, [toast]);

  const loadCards = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page, pageSize: 20 });
      if (search) p.set('search', search);
      if (filterSection) p.set('sectionId', filterSection);
      const res = await fetch(`/api/admin/cards?${p}`);
      if (!res.ok) throw new Error('加载卡片失败');
      setData(await res.json());
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [page, search, filterSection, toast]);

  useEffect(() => { loadSections(); }, [loadSections]);
  useEffect(() => { loadCards(); }, [loadCards]);

  function openCreate() { setForm(EMPTY_FORM); setModal('create'); }
  function openEdit(card) {
    setForm({
      title: card.title, description: card.description || '',
      url: card.url || '', sectionId: card.sectionId || '',
      order: card.order || '', permission: card.permission || 'public',
    });
    setModal(card);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    const isEdit = modal !== 'create';
    const url = isEdit ? `/api/admin/cards/${modal.id}` : '/api/admin/cards';
    try {
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          sectionId: form.sectionId || null,
          order: form.order ? parseInt(form.order) : undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || '保存失败'); return; }
      toast.success(isEdit ? '卡片已更新' : '卡片已创建');
      setModal(null);
      loadCards();
    } catch { toast.error('网络错误'); }
    finally { setSaving(false); }
  }

  async function handleDelete(card) {
    const ok = await confirm({
      title: '删除卡片',
      message: `确定要删除卡片「${card.title}」吗?此操作不可撤销。`,
      confirmText: '确认删除',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/admin/cards/${card.id}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || '删除失败'); return; }
      toast.success('卡片已删除');
      loadCards();
    } catch { toast.error('网络错误'); }
  }

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className={styles.stickyPage}>
      {/* 单行顶栏:标题 · 搜索 · 板块筛选 · 新建 */}
      <div className={styles.stickyTop}>
        <div className={styles.stickyHead}>
          <h1 className={styles.pageTitle}>卡片管理</h1>
          <div className={styles.stickyActions}>
            <input
              className={styles.searchInput}
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="搜索卡片标题..."
            />
            <select
              className={styles.filterSelect}
              value={filterSection}
              onChange={e => { setFilterSection(e.target.value); setPage(1); }}
            >
              <option value="">全部板块</option>
              <option value="ungrouped">未分组</option>
              {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="btn btn-primary btn-sm" onClick={openCreate}>＋ 新建卡片</button>
          </div>
        </div>
      </div>

      {/* 下方滚动 —— 卡片列表 */}
      <div className={styles.scrollArea}>
        <div className={styles.pageCard}>
          <div className={styles.tableWrap}>
            {loading ? (
              <div style={{ display:'flex', justifyContent:'center', padding:'40px' }}>
                <span className="spinner spinner-dark" style={{ width:24, height:24 }} />
              </div>
            ) : data.items.length === 0 ? (
              <EmptyState icon="⊟" title="暂无卡片" desc="创建卡片来丰富首页内容"
                          action={<button className="btn btn-outline btn-sm" onClick={openCreate}>新建卡片</button>} />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>标题</th><th>跳转地址</th><th>所属板块</th>
                    <th>访问权限</th><th>排序</th><th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map(card => {
                    const perm = PERM_LABELS[card.permission || 'public'];
                    return (
                      <tr key={card.id}>
                        <td>
                          <div style={{ fontWeight:500, fontSize:'0.9rem' }}>{card.title}</div>
                          {card.description && <div style={{ fontSize:'0.78rem', color:'var(--ink-3)', marginTop:2 }}>{card.description}</div>}
                        </td>
                        <td>
                          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                            <span style={{ fontFamily:'var(--font-mono)', fontSize:'0.78rem', color:'var(--ink-3)', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                              {card.url}
                            </span>
                            <a href={card.url} target="_blank" rel="noopener noreferrer"
                               style={{ color:'var(--amber)', fontSize:'0.75rem', flexShrink:0 }}>↗</a>
                          </div>
                        </td>
                        <td>
                          {card.sectionId ? <Badge type="blue">{card.sectionName}</Badge> : <Badge type="gray">未分组</Badge>}
                        </td>
                        <td><Badge type={perm.type}>{perm.label}</Badge></td>
                        <td style={{ fontFamily:'var(--font-mono)', fontSize:'0.82rem', color:'var(--ink-3)' }}>{card.order}</td>
                        <td>
                          <div style={{ display:'flex', gap:6 }}>
                            <button className="btn btn-outline btn-sm" onClick={() => openEdit(card)}>编辑</button>
                            <button className="btn btn-ghost btn-sm" style={{ color:'var(--ruby)' }}
                                    onClick={() => handleDelete(card)}>删除</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className={styles.tableFooter}>
            <span className={styles.tableCount}>共 {data.total} 张卡片</span>
            <Pagination page={page} totalPages={data.totalPages} onChange={setPage} />
          </div>
        </div>
      </div>

      {modal && (
        <Modal
          title={modal === 'create' ? '新建卡片' : '编辑卡片'}
          onClose={() => setModal(null)}
          size="md"
          footer={
            <>
              <button type="button" className="btn btn-outline" onClick={() => setModal(null)} disabled={saving}>取消</button>
              <button type="submit" form="card-form" className="btn btn-primary" disabled={saving}>
                {saving ? <Spinner /> : (modal === 'create' ? '创建' : '保存')}
              </button>
            </>
          }
        >
          <form id="card-form" onSubmit={handleSave} style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div className="form-group">
              <label className="form-label">标题 *</label>
              <input className="form-input" value={form.title} onChange={set('title')} required autoFocus />
            </div>
            <div className="form-group">
              <label className="form-label">跳转地址 *</label>
              <input className="form-input" value={form.url} onChange={set('url')}
                     placeholder="/account 或 https://example.com" required />
              <span className="form-hint">站内路由(/开头)或 http/https 外链</span>
            </div>
            <div className="form-group">
              <label className="form-label">描述</label>
              <input className="form-input" value={form.description} onChange={set('description')}
                     placeholder="可选的简短说明" />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <div className="form-group">
                <label className="form-label">所属板块</label>
                <select className="form-input" value={form.sectionId} onChange={set('sectionId')}>
                  <option value="">未分组</option>
                  {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">访问权限</label>
                <select className="form-input" value={form.permission} onChange={set('permission')}>
                  <option value="public">公开访问</option>
                  <option value="user">需要登录</option>
                  <option value="member">仅会员</option>
                  <option value="admin">仅管理员</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">排序</label>
              <input className="form-input" type="number" min="1" value={form.order}
                     onChange={set('order')} placeholder="数字越小越靠前" />
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
