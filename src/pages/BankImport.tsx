import { useMemo, useState } from 'react'
import type { ID } from '../domain/types'
import { useStore } from '../store/StoreProvider'
import { importBankRows } from '../store/actions'
import { platform } from '../store/platform'
import { buildRows, cellText, guessMapping, isDuplicate, parseDelimited, type Cell, type ColumnMapping } from '../domain/bankImport'
import { fmtDate } from '../domain/dates'
import { fmt } from '../domain/money'
import { Modal } from '../ui/Modal'
import { AccountSelect, Field } from '../ui/Form'
import { useDialogs } from '../ui/Dialogs'

/** Metni UTF-8 olarak çözer; Türkçe karakterler bozuksa Windows-1254 dener. */
function decodeText(data: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(data)
  if (!utf8.includes('�')) return utf8
  try {
    return new TextDecoder('windows-1254').decode(data)
  } catch {
    return utf8
  }
}

export function BankImportDialog({ onClose }: { onClose: () => void }) {
  const { state, scoped, apply } = useStore()
  const { toast } = useDialogs()
  const [accountId, setAccountId] = useState<ID>(scoped.accounts[0]?.id ?? '')
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<Cell[][] | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping | null>(null)
  const [selected, setSelected] = useState<Record<number, boolean>>({})
  const [categories, setCategories] = useState<Record<number, string>>({})
  const [updateBalance, setUpdateBalance] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const account = state.accounts.find((a) => a.id === accountId)

  const pick = async () => {
    setError(null)
    const f = await platform.openFile({ filters: [{ name: 'Banka ekstresi', extensions: ['csv', 'txt', 'xlsx', 'xls'] }] })
    if (!f) return
    try {
      let parsed: Cell[][]
      if (/\.(csv|txt)$/i.test(f.name)) parsed = parseDelimited(decodeText(f.data))
      else {
        const { readSheetRows } = await import('../domain/backup')
        parsed = readSheetRows(f.data) as Cell[][]
      }
      if (parsed.length < 2) throw new Error('Dosyada okunacak satır bulunamadı.')
      const m = guessMapping(parsed)
      setFileName(f.name)
      setRows(parsed)
      setMapping(m)
      setSelected({})
      setCategories({})
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const built = useMemo(() => (rows && mapping ? buildRows(rows, mapping) : []), [rows, mapping])
  const dupes = useMemo(() => new Set(built.filter((r) => isDuplicate(r, state.payments)).map((r) => r.index)), [built, state.payments])
  const isSelected = (i: number) => selected[i] ?? (!dupes.has(i) && !built.find((r) => r.index === i)?.error)
  const chosen = built.filter((r) => !r.error && isSelected(r.index))
  const header = rows && mapping ? (rows[mapping.headerRow] ?? []).map((c, i) => cellText(c) || `Sütun ${i + 1}`) : []
  const catFor = (i: number, amount: number) => categories[i] ?? (amount > 0 ? 'Diğer Gelir' : 'Diğer')

  const doImport = () => {
    if (!account || chosen.length === 0) return
    try {
      apply(
        (s) =>
          importBankRows(
            s,
            account.id,
            chosen.map((r) => ({ date: r.date!, description: r.description, amount: r.amount!, category: catFor(r.index, r.amount!) })),
            updateBalance,
          ),
        `${chosen.length} hareket içe aktarıldı`,
      )
      toast(`${chosen.length} hareket "${account.name}" için içe aktarıldı.`, { kind: 'success' })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const colSelect = (label: string, key: keyof Omit<ColumnMapping, 'headerRow'>) => (
    <Field label={label}>
      <select value={mapping![key]} onChange={(e) => setMapping({ ...mapping!, [key]: Number(e.target.value) })}>
        <option value={-1}>— yok —</option>
        {header.map((h, i) => (
          <option key={i} value={i}>
            {h}
          </option>
        ))}
      </select>
    </Field>
  )

  return (
    <Modal title="Banka Ekstresi İçe Aktar" onClose={onClose} wide dirty={!!rows}>
      <div className="form">
        <div className="form-row">
          <AccountSelect label="Hangi hesabın ekstresi?" value={accountId} onChange={setAccountId} />
          <Field label="Dosya (CSV veya Excel)" hint={fileName || 'Bankanızın internet şubesinden indirdiğiniz hesap hareketleri'}>
            <button type="button" className="btn" onClick={() => void pick()}>
              Dosya Seç…
            </button>
          </Field>
        </div>
        {error && <p className="field-error">{error}</p>}
        {rows && mapping && (
          <>
            <fieldset className="fieldset">
              <legend>Sütunlar (otomatik tahmin edildi, gerekirse düzeltin)</legend>
              <div className="form-row wrap">
                <Field label="Başlık satırı">
                  <input
                    type="number"
                    min={1}
                    max={rows.length}
                    value={mapping.headerRow + 1}
                    onChange={(e) => setMapping({ ...mapping, headerRow: Math.max(0, Number(e.target.value) - 1) })}
                  />
                </Field>
                {colSelect('Tarih', 'date')}
                {colSelect('Açıklama', 'description')}
                {colSelect('Tutar (işaretli)', 'amount')}
                {mapping.amount < 0 && colSelect('Borç / çıkan', 'debit')}
                {mapping.amount < 0 && colSelect('Alacak / giren', 'credit')}
              </div>
            </fieldset>
            <div className="table-scroll import-preview">
              <table className="table">
                <thead>
                  <tr>
                    <th>
                      <span className="sr-only">Seç</span>
                    </th>
                    <th>Tarih</th>
                    <th>Açıklama</th>
                    <th className="right">Tutar</th>
                    <th>Kategori</th>
                    <th>Not</th>
                  </tr>
                </thead>
                <tbody>
                  {built.map((r) => (
                    <tr key={r.index} className={r.error ? 'paid' : dupes.has(r.index) ? 'dupe' : ''}>
                      <td>
                        <input
                          type="checkbox"
                          disabled={!!r.error}
                          checked={!r.error && isSelected(r.index)}
                          onChange={(e) => setSelected({ ...selected, [r.index]: e.target.checked })}
                          aria-label={`Satır ${r.index + 1} içe aktar`}
                        />
                      </td>
                      <td>{r.date ? fmtDate(r.date) : '—'}</td>
                      <td>{r.description || '—'}</td>
                      <td className={`right ${r.amount && r.amount > 0 ? 'pos' : 'neg'}`}>{r.amount !== null ? fmt(r.amount, account?.currency) : '—'}</td>
                      <td>
                        {!r.error && r.amount !== null && (
                          <select
                            className="status-select"
                            value={catFor(r.index, r.amount)}
                            onChange={(e) => setCategories({ ...categories, [r.index]: e.target.value })}
                            aria-label="Kategori"
                          >
                            {state.categories
                              .filter((c) => c.kind === (r.amount! > 0 ? 'in' : 'out'))
                              .map((c) => (
                                <option key={c.id} value={c.name}>
                                  {c.name}
                                </option>
                              ))}
                          </select>
                        )}
                      </td>
                      <td className="muted">{r.error ?? (dupes.has(r.index) ? 'Zaten kayıtlı olabilir' : '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="check-inline">
              <input type="checkbox" checked={updateBalance} onChange={(e) => setUpdateBalance(e.target.checked)} />
              Hesap bakiyesini de güncelle (girdiğiniz bakiye bu hareketleri henüz içermiyorsa işaretleyin)
            </label>
          </>
        )}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Vazgeç
          </button>
          <button type="button" className="btn primary" disabled={!rows || chosen.length === 0} onClick={doImport}>
            {chosen.length ? `${chosen.length} hareketi içe aktar` : 'İçe aktar'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
