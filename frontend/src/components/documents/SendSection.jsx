import { useState } from 'react'
import { toast } from 'sonner'
import { Mail, MessageCircle, Send } from 'lucide-react'
import { useCreateShareMutation, useEmailShareMutation } from '@/store/api/documentsApi'
import { useGetPeopleQuery } from '@/store/api/peopleApi'
import { PersonAvatar } from '@/components/people/PersonAvatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { errorMessage } from '@/components/common/ErrorBox'
import { openExternal, whatsappNumber } from '@/lib/openExternal'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LINK_HOURS = 168

/**
 * Send a document from here: to someone in the vault, any email address or a
 * WhatsApp number. Each goes as a link that opens the document (7 days).
 */
export function SendSection({ workspaceId, document: doc, shares = [] }) {
  const { data: people = [] } = useGetPeopleQuery(workspaceId, { skip: !workspaceId })
  const [createShare] = useCreateShareMutation()
  const [emailShare] = useEmailShareMutation()
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(null) // what is being sent

  const reachable = people.filter((p) => p.email || p.phone)

  // A link without password that works for at least another day, else a new one.
  const link = async () => {
    const soon = Date.now() + 24 * 3600 * 1000
    const open = shares.find((s) => s.url && !s.has_password && (!s.expires_at || new Date(s.expires_at).getTime() > soon))
    if (open) return open
    return createShare({ workspaceId, document_id: doc.id, kind: 'link', expires_in_hours: LINK_HOURS, allow_download: true }).unwrap()
  }

  const sendEmail = async (to, key = to) => {
    if (!EMAIL_RE.test(to)) {
      toast.error('Please enter a valid email address.')
      return
    }
    setBusy(key)
    try {
      const share = await link()
      const res = await emailShare({ workspaceId, shareId: share.id, to }).unwrap()
      if (res.sent) {
        toast.success(`Sent to ${to}.`)
        setEmail('')
      } else {
        // Email is not set up on the server: the phone's mail app sends it.
        const body = `${doc.name}\n${res.url || share.url}`
        openExternal(`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(doc.name)}&body=${encodeURIComponent(body)}`)
      }
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const sendWhatsapp = async (number, key = number) => {
    const to = whatsappNumber(number)
    if (!to) {
      toast.error('Please enter a phone number with 10 digits, or with the country code.')
      return
    }
    setBusy(key)
    try {
      const share = await link()
      openExternal(`https://wa.me/${to}?text=${encodeURIComponent(`${doc.name}\n${share.url}`)}`)
      setPhone('')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-3">
      <h3 className="text-sm font-semibold">Send</h3>
      {reachable.length > 0 && (
        <ul className="flex flex-col gap-1">
          {reachable.map((p) => (
            <li key={p.id} className="flex items-center gap-3">
              <PersonAvatar person={p} className="size-9" />
              <span className="min-w-0 flex-1 truncate text-sm">{p.display_name}</span>
              <Button size="icon" variant="ghost" aria-label={`Email ${p.display_name}`} title={p.email || 'No email'} disabled={!p.email || !!busy} onClick={() => sendEmail(p.email, `e-${p.id}`)}>
                {busy === `e-${p.id}` ? <Spinner size="sm" /> : <Mail />}
              </Button>
              <Button size="icon" variant="ghost" className="text-emerald-600" aria-label={`WhatsApp ${p.display_name}`} title={p.phone || 'No phone number'} disabled={!p.phone || !!busy} onClick={() => sendWhatsapp(p.phone, `w-${p.id}`)}>
                {busy === `w-${p.id}` ? <Spinner size="sm" /> : <MessageCircle />}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); sendEmail(email.trim()) }}>
        <Input type="email" inputMode="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email address" />
        <Button type="submit" size="icon" className="size-9 shrink-0" aria-label="Send by email" disabled={!email.trim() || !!busy}>
          {busy && busy === email.trim() ? <Spinner size="sm" /> : <Send />}
        </Button>
      </form>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); sendWhatsapp(phone.trim()) }}>
        <Input type="tel" inputMode="tel" placeholder="WhatsApp number" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="WhatsApp number" />
        <Button type="submit" size="icon" className="size-9 shrink-0 bg-emerald-600 hover:bg-emerald-700" aria-label="Send on WhatsApp" disabled={!phone.trim() || !!busy}>
          {busy && busy === phone.trim() ? <Spinner size="sm" /> : <MessageCircle />}
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">They get a link that opens this document for 7 days.</p>
    </div>
  )
}
