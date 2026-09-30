import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { Logo } from '@/components/common/Logo'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function AuthLayout({ title, description, children, footer }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted/30 px-4 py-10">
      <Link to="/" className="mb-6 flex items-center gap-2">
        <Logo className="size-9" />
        <span className="text-xl font-semibold tracking-tight">DastaVault</span>
      </Link>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="w-full max-w-sm"
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
        {footer && <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>}
      </motion.div>
    </div>
  )
}
