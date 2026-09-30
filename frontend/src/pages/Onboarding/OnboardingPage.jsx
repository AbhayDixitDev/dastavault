import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { ArrowLeft, Check } from 'lucide-react'
import { WORKSPACE_KINDS, TERMINOLOGY_FIELDS, terminologyFor } from '@/constants/terminology'
import { useCreateWorkspaceMutation, useGetWorkspacesQuery } from '@/store/api/workspacesApi'
import { Logo } from '@/components/common/Logo'
import { KindIcon } from '@/components/common/KindIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/components/common/ErrorBox'

export function OnboardingPage() {
  const navigate = useNavigate()
  const { data: workspaces = [] } = useGetWorkspacesQuery()
  const [createWorkspace, { isLoading }] = useCreateWorkspaceMutation()
  const [step, setStep] = useState(1)
  const [kind, setKind] = useState(null)
  const [name, setName] = useState('')
  const [terms, setTerms] = useState(terminologyFor('custom'))

  const chooseKind = (k) => {
    setKind(k)
    setTerms(terminologyFor(k))
    setStep(2)
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return toast.error('Please give it a name.')
    try {
      const ws = await createWorkspace({
        name: name.trim(),
        kind,
        terminology: kind === 'custom' ? terms : undefined,
      }).unwrap()
      toast.success(`${ws.name} is ready.`)
      navigate(`/w/${ws.id}`, { replace: true })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const kindInfo = WORKSPACE_KINDS.find((k) => k.key === kind)

  return (
    <div className="min-h-svh bg-muted/30 px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo className="size-8" />
            <span className="font-semibold">DastaVault</span>
          </div>
          {workspaces.length > 0 && (
            <Button asChild variant="ghost" size="sm">
              <Link to="/w">Cancel</Link>
            </Button>
          )}
        </div>

        {step === 1 && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="text-2xl font-bold md:text-3xl">What are you organising?</h1>
            <p className="mt-1 text-muted-foreground">You can change the words later in Settings.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {WORKSPACE_KINDS.map((k, i) => (
                <motion.button
                  key={k.key}
                  type="button"
                  onClick={() => chooseKind(k.key)}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  whileTap={{ scale: 0.98 }}
                  className="rounded-2xl border bg-card p-5 text-left transition-colors hover:border-primary hover:bg-primary/5"
                >
                  <KindIcon kind={k.key} size="lg" />
                  <h3 className="mt-2 font-semibold">{k.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{k.description}</p>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.form onSubmit={submit} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-md">
            <button type="button" onClick={() => setStep(1)} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" /> Back
            </button>
            <KindIcon kind={kind} size="lg" />
            <h1 className="mt-2 text-2xl font-bold">Name your {terms.workspace_label.toLowerCase()}</h1>
            <p className="mt-1 text-muted-foreground">For example: {kind === 'family' ? 'Patel Family' : kind === 'company' ? 'ABC Technologies' : kind === 'school' ? 'Sunrise Public School' : 'My Documents'}</p>

            <div className="mt-6 grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Type a name" className="h-11" />
            </div>

            {kind === 'custom' && (
              <div className="mt-6 rounded-xl border bg-card p-4">
                <h2 className="font-medium">Your own words</h2>
                <p className="mb-3 text-sm text-muted-foreground">These labels appear everywhere in the app.</p>
                <div className="grid gap-3">
                  {TERMINOLOGY_FIELDS.map(([key, label]) => (
                    <div key={key} className="grid gap-1">
                      <Label htmlFor={key} className="text-xs text-muted-foreground">{label}</Label>
                      <Input id={key} value={terms[key]} onChange={(e) => setTerms({ ...terms, [key]: e.target.value })} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {kind !== 'custom' && (
              <div className="mt-6 rounded-xl border bg-card p-4 text-sm">
                <p className="font-medium">We will use these words</p>
                <ul className="mt-2 grid gap-1 text-muted-foreground">
                  <li className={cn('flex items-center gap-2')}><Check className="size-4 text-primary" /> People: {terms.person_label_plural}</li>
                  <li className="flex items-center gap-2"><Check className="size-4 text-primary" /> Groups: {terms.group_label_plural}</li>
                  <li className="flex items-center gap-2"><Check className="size-4 text-primary" /> Sub groups: {terms.subgroup_label_plural}</li>
                </ul>
              </div>
            )}

            <Button type="submit" size="xl" className="mt-6 w-full" disabled={isLoading}>
              {isLoading && <Spinner />} Create {terms.workspace_label.toLowerCase()}
            </Button>
          </motion.form>
        )}
      </div>
    </div>
  )
}
