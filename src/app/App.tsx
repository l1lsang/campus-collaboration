import { BrowserRouter, Link, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { RootLayout } from './layouts/RootLayout'
import { RequireAuth, RequireProfile } from './router/guards'
import { AuthProvider } from '../features/auth/auth-provider'
import { LandingPage } from '../features/landing/LandingPage'
import { DiscardReportDraft, ReportDraftScope } from '../features/reports/ReportDraftScope'
import { isSupabaseConfigured } from '../lib/supabase/client'
import { Loading, PageHeading, Unconfigured } from '../components/common/states'
import { Button } from '../components/ui/button'

const AuthPage = lazy(() =>
  import('../features/auth/AuthPage').then((module) => ({ default: module.AuthPage })),
)
const AuthCallbackPage = lazy(() =>
  import('../features/auth/AuthPage').then((module) => ({ default: module.AuthCallbackPage })),
)
const DashboardPage = lazy(() =>
  import('../features/dashboard/DashboardPage').then((module) => ({
    default: module.DashboardPage,
  })),
)
const ProfilePage = lazy(() =>
  import('../features/profiles/ProfilePage').then((module) => ({ default: module.ProfilePage })),
)
const ProfileSettingsPage = lazy(() =>
  import('../features/profiles/ProfileSettingsPage').then((module) => ({
    default: module.ProfileSettingsPage,
  })),
)
const CreateProjectPage = lazy(() =>
  import('../features/projects/CreateProjectPage').then((module) => ({
    default: module.CreateProjectPage,
  })),
)
const ExplorePage = lazy(() =>
  import('../features/projects/ExplorePage').then((module) => ({ default: module.ExplorePage })),
)
const InvitePage = lazy(() =>
  import('../features/projects/InvitePage').then((module) => ({ default: module.InvitePage })),
)
const ProjectPage = lazy(() =>
  import('../features/projects/ProjectPage').then((module) => ({ default: module.ProjectPage })),
)
const TeamWorkbenchPage = lazy(() =>
  import('../features/team/TeamWorkbenchPage').then((module) => ({
    default: module.TeamWorkbenchPage,
  })),
)
const ResearchPage = lazy(() =>
  import('../features/research/ResearchPage').then((module) => ({ default: module.ResearchPage })),
)
const MatchingPage = lazy(() =>
  import('../features/matching/MatchingPage').then((module) => ({ default: module.MatchingPage })),
)
const ProjectReportsPage = lazy(() =>
  import('../features/reports/ProjectReportsPage').then((module) => ({
    default: module.ProjectReportsPage,
  })),
)
const ArchivePage = lazy(() =>
  import('../features/reports/ArchivePage').then((module) => ({ default: module.ArchivePage })),
)

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000 }, mutations: { retry: 0, gcTime: 0 } },
})

function BackendRoute({ children }: { children: React.ReactNode }) {
  return isSupabaseConfigured ? (
    children
  ) : (
    <main className="container page" id="main-content">
      <Unconfigured />
    </main>
  )
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<RootLayout />}>
        <Route index element={<LandingPage />} />
        <Route path="explore" element={<ExplorePage />} />
        <Route
          path="research/*"
          element={
            <BackendRoute>
              <ResearchPage />
            </BackendRoute>
          }
        />
        <Route
          path="opportunities/*"
          element={
            <BackendRoute>
              <MatchingPage />
            </BackendRoute>
          }
        />
        <Route
          path="archive"
          element={
            <BackendRoute>
              <ArchivePage />
            </BackendRoute>
          }
        />
        <Route path="login" element={<AuthPage key="login" mode="login" />} />
        <Route path="signup" element={<AuthPage key="signup" mode="signup" />} />
        <Route path="invite" element={<InvitePage />} />
        <Route path="auth/callback" element={<AuthCallbackPage />} />
        <Route
          path="profile/:id"
          element={
            <BackendRoute>
              <ProfilePage />
            </BackendRoute>
          }
        />
        <Route
          path="projects/:id"
          element={
            <BackendRoute>
              <ProjectPage />
            </BackendRoute>
          }
        />
        <Route
          path="projects/:id/members"
          element={
            <BackendRoute>
              <ProjectPage team />
            </BackendRoute>
          }
        />
        <Route element={<RequireAuth />}>
          <Route path="onboarding" element={<ProfileSettingsPage onboarding />} />
          <Route path="settings" element={<ProfileSettingsPage />} />
          <Route element={<RequireProfile />}>
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="projects/new" element={<CreateProjectPage />} />
            <Route path="projects/:id/team" element={<TeamWorkbenchPage />} />
          </Route>
        </Route>
        <Route path="projects/:id/reports" element={<ReportDraftScope />}>
          <Route element={<RequireAuth />}>
            <Route
              element={
                <RequireProfile
                  waitForInitialRefresh
                  verificationFailure={<DiscardReportDraft />}
                />
              }
            >
              <Route index element={<ProjectReportsPage />} />
            </Route>
          </Route>
        </Route>
        <Route
          path="*"
          element={
            <main className="narrow page" id="main-content">
              <PageHeading title="페이지를 찾을 수 없어요" description="주소를 확인해 주세요." />
              <Button asChild>
                <Link to="/">홈으로 돌아가기</Link>
              </Button>
            </main>
          }
        />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Suspense
            fallback={
              <main className="container page">
                <Loading />
              </main>
            }
          >
            <AppRoutes />
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
