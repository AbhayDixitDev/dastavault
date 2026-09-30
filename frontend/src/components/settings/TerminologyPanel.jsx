import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useUpdateTerminologyMutation } from '@/store/api/workspacesApi'
import { TERMINOLOGY_FIELDS, TERMINOLOGY_TEMPLATES, WORKSPACE_KINDS } from '@/constants/terminology'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { errorMessage } from '@/components/common/ErrorBox'

export function TerminologyPanel() {
  const { workspace, terminology, can } = useWorkspace()
  const [updateTerminology, { isLoading }] = useUpdateTerminologyMutation()
  const [values, setValues] = useState(terminology)
  const canManage = can('admin')

  useEffect(() => setValues(terminology), [terminology])

  const save = async (e) => {
    e.preventDefault()
    try {
      await updateTerminology({ workspaceId: workspace.id, ...values }).unwrap()
      toast.success('Words updated everywhere.')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your words</CardTitle>
        <CardDescription>
          Choose what the app calls people and groups here. For example a company says Employees and Departments; a school says Students and Classes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="flex flex-col gap-4">
          {canManage && (
            <div className="flex flex-wrap gap-2">
              {WORKSPACE_KINDS.filter((k) => k.key !== 'custom').map((k) => (
                <Button key={k.key} type="button" variant="outline" size="sm" onClick={() => setValues({ ...values, ...TERMINOLOGY_TEMPLATES[k.key] })}>
                  {k.emoji} Use {k.title} words
                </Button>
              ))}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {TERMINOLOGY_FIELDS.map(([key, label]) => (
              <div key={key} className="grid gap-1">
                <Label htmlFor={`t-${key}`} className="text-xs text-muted-foreground">{label}</Label>
                <Input id={`t-${key}`} value={values[key] ?? ''} onChange={(e) => setValues({ ...values, [key]: e.target.value })} disabled={!canManage} />
              </div>
            ))}
          </div>
          {canManage && (
            <Button type="submit" disabled={isLoading} className="self-start">
              {isLoading && <Spinner />} Save words
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
