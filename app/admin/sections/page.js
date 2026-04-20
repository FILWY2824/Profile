'use client';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Spinner, Modal, EmptyState, useToast, useConfirm } from '@/components/ui/index.js';
import styles from '../admin.module.css';

const EMPTY = { name:'', slug:'', description:'', order:'' };

export default function AdminSections() {
  const toast = useToast();
  const confirm = useConfirm();
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/sections');
      if (!res.ok) throw new Error('加载板块失败');
      const d = await res.json();
      setSections(d.sections || []);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  function openCreate() { setForm(EMPTY); setModal('create'); }
  function openEdit(s) {
    setForm({ name: s.name, slug: s.slug, description: s.description || '', order: s.order || '' });
    setModal(s);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    const isEdit = modal !== 'create';
    const url = isEdit ? `/api/admin/sections/${modal.id}` : '/api/admin/sections';
    const method = isEdit ? 'PATCH' : 'POST';
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, order: form.order ? parseInt(form.order) : undefined }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || '保存失败'); return; }
      toast.success(isEdit ? '板块已更新' : '板块已创建');
      setModal(null);
      load();
    } catch { toast.error('网络错误'); }
    finally { setSaving(false); }
  }

  async function handleDelete(s) {
    const ok = await confirm({
      title: '删除板块',
      message: `确定要删除板块「${s.name}」吗?该板块下的 ${s.cardCount} 张卡片将移至未分组,不会被删除。`,
      confirmText: '确认删除',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/admin/sections/${s.id}`, { method:'DELETE' });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || '删除失败'); return; }
      toast.success(`板块已删除,${data.movedCards} 张卡片已移至未分组`);
      load();
    } catch { toast.error('网络错误'); }
  }

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  // 前端过滤 —— 板块数量不大,不必走服务器搜索
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter(s =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.slug || '').toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q)
    );
  }, [sections, search]);

  return (
    <div className={styles.stickyPage}>
      <div className={styles.stickyTop}>
        <div className={styles.stickyHead}>
          <h1 className={styles.pageTitle}>板块管理</h1>
          <div className={styles.stickyActions}>
            <input
              className={styles.searchInput}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索名称 / Slug / 描述..."
            />
            <span style={{ fontSize:'0.78rem', color:'var(--ink-3)', whiteSpace:'nowrap' }}>
              {search ? `匹配 ${visible.length} / ${sections.length}` : `共 ${sections.length} 个`}
            </span>
            <button className="btn btn-primary btn-sm" onClick={openCreate}>＋ 新建板块</button>
          </div>
        </div>
      </div>

      <div className={styles.scrollArea}>
        <div className={styles.pageCard}>
          {loading ? (
            <div style={{ display:'flex', justifyContent:'center', padding:'40px' }}>
              <span className="spinner spinner-dark" style={{ width:24, height:24 }} />
            </div>
          ) : sections.length === 0 ? (
            <EmptyState icon="⊞" title="暂无板块" desc="创建板块来组织首页卡片"
                        action={<button className="btn btn-outline btn-sm" onClick={openCreate}>新建板块</button>} />
          ) : visible.length === 0 ? (
            <EmptyState icon="⊘" title="没有匹配结果" desc={`没有板块匹配「${search}」`} />
          ) : (
            <div className={styles.tableWrap}>
              <table className="data-table">
                <thead>
                  <tr><th>排序</th><th>名称</th><th>Slug</th><th>描述</th><th>卡片数</th><th>操作</th></tr>
                </thead>
                <tbody>
                  {visible.map(s => (
                    <tr key={s.id}>
                      <td style={{ fontFamily:'var(--font-mono)', fontSize:'0.85rem', color:'var(--ink-3)' }}>{s.order}</td>
                      <td style={{ fontWeight:500 }}>{s.name}</td>
                      <td style={{ fontFamily:'var(--font-mono)', fontSize:'0.82rem', color:'var(--ink-3)' }}>{s.slug}</td>
                      <td style={{ color:'var(--ink-3)', fontSize:'0.85rem' }}>{s.description || '-'}</td>
                      <td style={{ color:'var(--ink-2)', fontWeight:500 }}>{s.cardCount}</td>
                      <td>
                        <div style={{ display:'flex', gap:6 }}>
                          <button className="btn btn-outline btn-sm" onClick={() => openEdit(s)}>编辑</button>
                          <button className="btn btn-ghost btn-sm" style={{ color:'var(--ruby)' }}
                                  onClick={() => handleDelete(s)}>删除</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {modal && (
        <Modal
          title={modal === 'create' ? '新建板块' : '编辑板块'}
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-outline" onClick={() => setModal(null)}>取消</button>
              <button type="submit" form="section-form" className="btn btn-primary" disabled={saving}>
                {saving ? <Spinner /> : (modal === 'create' ? '创建' : '保存')}
              </button>
            </>
          }
        >
          <form id="section-form" onSubmit={handleSave} style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div className="form-group">
              <label className="form-label">名称 *</label>
              <input className="form-input" value={form.name} onChange={set('name')} required autoFocus />
            </div>
            <div className="form-group">
              <label className="form-label">Slug *</label>
              <input className="form-input" value={form.slug} onChange={set('slug')}
                     placeholder="例:quick-access" required disabled={modal !== 'create'} />
              <span className="form-hint">仅限小写字母、数字和连字符{modal !== 'create' ? '(创建后不可修改)' : ''}</span>
            </div>
            <div className="form-group">
              <label className="form-label">描述</label>
              <input className="form-input" value={form.description} onChange={set('description')} placeholder="可选" />
            </div>
            <div className="form-group">
              <label className="form-label">排序</label>
              <input className="form-input" type="number" min="1" value={form.order} onChange={set('order')} placeholder="数字越小越靠前" />
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
