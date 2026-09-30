import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

export function errorMessage(error) {
  if (!error) return ''
  if (typeof error === 'string') return error
  return error.message || error.data?.error || 'Something went wrong.'
}

export function ErrorBox({ error, title = 'Something went wrong', onRetry, className }) {
  if (!error) return null
  return (
    <Alert variant="destructive" className={className}>
      <AlertCircle className="size-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{errorMessage(error)}</p>
        {onRetry && (
          <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}>
            Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}
