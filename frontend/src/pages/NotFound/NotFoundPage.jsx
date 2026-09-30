import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60svh] items-center justify-center p-6">
      <EmptyState
        icon={Compass}
        title="This page does not exist"
        description="The link may be old or mistyped."
        action={
          <Button asChild>
            <Link to="/w">Go to my workspaces</Link>
          </Button>
        }
      />
    </div>
  )
}
