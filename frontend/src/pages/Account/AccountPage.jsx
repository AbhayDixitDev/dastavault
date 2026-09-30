import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useGetMeQuery, useUpdateMeMutation } from '@/store/api/workspacesApi'
import { selectUi, setLargeText, setTheme } from '@/store/slices/uiSlice'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { errorMessage } from '@/components/common/ErrorBox'

export function AccountPage() {
  const { user, signOut } = useAuth()
  const { data: profile } = useGetMeQuery()
  const [updateMe, { isLoading: saving }] = useUpdateMeMutation()
  const dispatch = useDispatch()
  const { theme, largeText } = useSelector(selectUi)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    setName(profile?.display_name ?? user?.metadata?.display_name ?? '')
  }, [profile, user])

  const saveProfile = async (e) => {
    e.preventDefault()
    try {
      await updateMe({ display_name: name }).unwrap()
      await supabase.auth.updateUser({ data: { display_name: name } })
      toast.success('Saved.')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const changePassword = async (e) => {
    e.preventDefault()
    if (password.length < 8) return toast.error('Use at least 8 characters.')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) return toast.error(error.message)
    setPassword('')
    toast.success('Password changed.')
  }

  return (
    <div className="min-h-svh bg-muted/30 px-4 py-6">
      <div className="mx-auto flex max-w-lg flex-col gap-4">
        <Link to="/w" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back
        </Link>
        <h1 className="text-2xl font-bold">My account</h1>

        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>{user?.email}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveProfile} className="flex flex-col gap-3">
              <div className="grid gap-2">
                <Label htmlFor="name">Display name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <Button type="submit" disabled={saving} className="self-start">
                {saving && <Spinner />} Save
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="theme">Theme</Label>
              <Select value={theme} onValueChange={(v) => dispatch(setTheme(v))}>
                <SelectTrigger id="theme" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">Same as device</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="large">Large text</Label>
                <p className="text-xs text-muted-foreground">Makes everything a little bigger.</p>
              </div>
              <Switch id="large" checked={largeText} onCheckedChange={(v) => dispatch(setLargeText(v))} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={changePassword} className="flex flex-col gap-3">
              <div className="grid gap-2">
                <Label htmlFor="pw">New password</Label>
                <Input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <Button type="submit" variant="outline" className="self-start">Change password</Button>
            </form>
          </CardContent>
        </Card>

        <Button variant="ghost" onClick={() => signOut()} className="self-start">Sign out</Button>
      </div>
    </div>
  )
}
