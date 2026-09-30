import { useNavigate, useParams } from 'react-router-dom'
import { useWorkspace } from '@/hooks/useWorkspace'
import { PageHeader } from '@/components/ui/page-header'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { GeneralPanel } from '@/components/settings/GeneralPanel'
import { TerminologyPanel } from '@/components/settings/TerminologyPanel'
import { MembersPanel } from '@/components/settings/MembersPanel'

export function SettingsPage() {
  const { tab = 'general' } = useParams()
  const navigate = useNavigate()
  const { terminology: t, can } = useWorkspace()

  const onTab = (v) => navigate(v === 'general' ? '../settings' : `../settings/${v}`, { relative: 'path' })

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" description={`Manage this ${t.workspace_label.toLowerCase()}.`} />
      <Tabs value={tab} onValueChange={onTab}>
        <TabsList className="mb-4 w-full justify-start overflow-x-auto">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="words">Words</TabsTrigger>
          <TabsTrigger value="members">{t.member_label_plural}</TabsTrigger>
        </TabsList>
        <TabsContent value="general"><GeneralPanel /></TabsContent>
        <TabsContent value="words"><TerminologyPanel /></TabsContent>
        <TabsContent value="members"><MembersPanel canManage={can('admin')} /></TabsContent>
      </Tabs>
    </div>
  )
}
