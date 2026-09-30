import { Link, Navigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { ScanLine, Search, KeyRound, StickyNote, ShieldCheck, WifiOff, Sparkles, Users } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Logo } from '@/components/common/Logo'
import { Button } from '@/components/ui/button'

const FEATURES = [
  { icon: ScanLine, title: 'Scan with your phone', text: 'Point, shoot, done. Edges are found and the page is straightened for you.' },
  { icon: Search, title: 'Find it by saying it', text: '"Dad passport" or "AWS invoice September". Type it, or say it.' },
  { icon: Sparkles, title: 'Named for you', text: 'No more IMG_3928.jpg. You get "Rahul Patel - Passport - 2032".' },
  { icon: Users, title: 'For families and teams', text: 'Family members, departments, classes. Your words, not ours.' },
  { icon: KeyRound, title: 'Chaabi password keeper', text: 'Passwords locked with a PIN and encrypted on your device.' },
  { icon: StickyNote, title: 'Notes and writing', text: 'Write notes and documents right here. Edit them any time.' },
  { icon: WifiOff, title: 'Works offline', text: 'Scan without internet. It uploads when you are back online.' },
  { icon: ShieldCheck, title: 'Private by design', text: 'Files stay in a private bucket. Nobody else can see your workspace.' },
]

export function LandingPage() {
  const { isSignedIn } = useAuth()
  if (isSignedIn) return <Navigate to="/w" replace />

  return (
    <div className="min-h-svh bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2">
          <Logo className="size-8" />
          <span className="text-lg font-semibold tracking-tight">DastaVault</span>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="ghost">
            <Link to="/login">Sign in</Link>
          </Button>
          <Button asChild>
            <Link to="/signup">Get started</Link>
          </Button>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,theme(colors.primary/15%),transparent_60%)]" />
        <div className="mx-auto max-w-4xl px-4 pb-16 pt-16 text-center md:pt-24">
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="text-4xl font-bold tracking-tight md:text-6xl"
          >
            Every document your family or team needs.
            <span className="block text-primary">Found in seconds.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground"
          >
            Scan papers with your phone, let DastaVault read and name them, and find anything by typing or
            saying something as simple as “mom health insurance”. Passwords and notes live here too.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <Button asChild size="xl">
              <Link to="/signup">Create your free vault</Link>
            </Button>
            <Button asChild size="xl" variant="outline">
              <Link to="/login">I already have an account</Link>
            </Button>
          </motion.div>
          <p className="mt-4 text-xs text-muted-foreground">Free to use. Runs on free-tier cloud services. No credit card.</p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => {
            const Icon = f.icon
            return (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.35, delay: i * 0.05 }}
                className="rounded-2xl border bg-card p-5"
              >
                <Icon className="size-6 text-primary" />
                <h3 className="mt-3 font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{f.text}</p>
              </motion.div>
            )
          })}
        </div>
      </section>

      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        DastaVault. A personal project by Abhay Dixit. MIT licensed.
      </footer>
    </div>
  )
}
