import { createSlice } from '@reduxjs/toolkit'

const initialState = {
  status: 'loading', // 'loading' | 'signedOut' | 'signedIn'
  user: null, // { id, email, user_metadata }
}

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    sessionChanged(state, action) {
      const session = action.payload
      if (session?.user) {
        state.status = 'signedIn'
        state.user = {
          id: session.user.id,
          email: session.user.email,
          emailConfirmed: Boolean(session.user.email_confirmed_at),
          metadata: session.user.user_metadata ?? {},
        }
      } else {
        state.status = 'signedOut'
        state.user = null
      }
    },
  },
})

export const { sessionChanged } = authSlice.actions
export default authSlice.reducer

export const selectAuth = (state) => state.auth
export const selectUser = (state) => state.auth.user
