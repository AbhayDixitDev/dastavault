import { Link } from 'react-router-dom'
import { ScanLine, Search, FileText, Images, StickyNote, KeyRound, BellRing, Activity, Upload, Trash2 } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'

const FEATURES = {
  search: { icon: Search, title: 'Search', text: 'Search by name, by meaning, by voice and by photo is coming in Phase 5 and 6.' },
  scan: { icon: ScanLine, title: 'Scan a document', text: 'The camera scanner with automatic cropping is coming in Phase 3.' },
  upload: { icon: Upload, title: 'Upload a file', text: 'Uploading files is coming in Phase 2.' },
  documents: { icon: FileText, title: 'Documents', text: 'Your documents list is coming in Phase 2.' },
  document: { icon: FileText, title: 'Document', text: 'The document viewer is coming in Phase 2.' },
  trash: { icon: Trash2, title: 'Trash', text: 'Deleted documents stay here for 30 days. Coming in Phase 2.' },
  albums: { icon: Images, title: 'Albums', text: 'Albums and smart albums are coming in Phase 7.' },
  notes: { icon: StickyNote, title: 'Notes', text: 'Notes and writing documents are coming in Phase 9.' },
  chaabi: { icon: KeyRound, title: 'Chaabi', text: 'Your PIN-locked password keeper is coming in Phase 9.' },
  reminders: { icon: BellRing, title: 'Reminders', text: 'Expiry reminders are coming in Phase 7.' },
  activity: { icon: Activity, title: 'Activity', text: 'The activity timeline is coming in Phase 7.' },
}

export function ComingSoonPage({ feature }) {
  const f = FEATURES[feature] ?? { icon: FileText, title: 'Coming soon', text: 'This part is not ready yet.' }
  return (
    <div className="mx-auto max-w-2xl py-10">
      <EmptyState
        icon={f.icon}
        title={f.title}
        description={f.text}
        action={
          <Button asChild variant="outline">
            <Link to="..">Back to Home</Link>
          </Button>
        }
      />
    </div>
  )
}
