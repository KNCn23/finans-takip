import { useMemo, useState, type ReactNode } from 'react'
import { SearchIcon } from './Icons'

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  /** Sıralama değeri; verilmezse sütun sıralanamaz */
  sort?: (row: T) => string | number
  align?: 'right'
  className?: string
}

interface Props<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  /** Arama kutusunun tarayacağı metin */
  searchText?: (row: T) => string
  searchPlaceholder?: string
  defaultSort?: { key: string; dir: 'asc' | 'desc' }
  emptyText?: string
  rowClassName?: (row: T) => string
  toolbar?: ReactNode
  onRowClick?: (row: T) => void
}

const collator = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' })

/** Aranabilir, sütun başlığına tıklanarak sıralanabilir tablo. */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  searchText,
  searchPlaceholder = 'Ara…',
  defaultSort,
  emptyText = 'Kayıt yok.',
  rowClassName,
  toolbar,
  onRowClick,
}: Props<T>) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState(defaultSort ?? null)
  const visible = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase('tr')
    let list = needle && searchText ? rows.filter((r) => searchText(r).toLocaleLowerCase('tr').includes(needle)) : rows
    const col = sort && columns.find((c) => c.key === sort.key)
    if (col?.sort) {
      const f = col.sort
      list = [...list].sort((a, b) => {
        const va = f(a)
        const vb = f(b)
        const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : collator.compare(String(va), String(vb))
        return sort!.dir === 'asc' ? c : -c
      })
    }
    return list
  }, [rows, q, sort, columns, searchText])

  const toggle = (key: string) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))

  return (
    <div className="data-table">
      {(searchText || toolbar) && (
        <div className="table-toolbar">
          {searchText && (
            <div className="search-box">
              <SearchIcon size={15} />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
              />
            </div>
          )}
          {toolbar}
          {q && (
            <span className="muted">
              {visible.length} / {rows.length} kayıt
            </span>
          )}
        </div>
      )}
      {visible.length === 0 ? (
        <div className="empty-line">{q ? 'Aramayla eşleşen kayıt yok.' : emptyText}</div>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                {columns.map((c) => {
                  const active = sort?.key === c.key
                  return (
                    <th
                      key={c.key}
                      className={`${c.align === 'right' ? 'right' : ''} ${c.className ?? ''}`}
                      aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      {c.sort ? (
                        <button type="button" className="th-sort" onClick={() => toggle(c.key)}>
                          {c.header}
                          <span className="sort-mark" aria-hidden="true">
                            {active ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}
                          </span>
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={rowKey(r)}
                  className={`${rowClassName?.(r) ?? ''}${onRowClick ? ' clickable' : ''}`}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={`${c.align === 'right' ? 'right' : ''} ${c.className ?? ''}`}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
