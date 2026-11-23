import { Info, LogOut, UserRound } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { Button } from '../../components/ui/button'
import { Notice } from '../../components/common/states'
import { brand } from '../../lib/constants/brand'
import { getSupabase } from '../../lib/supabase/client'
import { useAuth } from '../../features/auth/auth-provider'

function Wordmark() {
  return (
    <span className="brand-wordmark">
      {brand.wordmark}
      <span className="brand-period">.</span>
    </span>
  )
}

export function BrandLink() {
  return (
    <Link to="/" className="brand" aria-label={`${brand.name} 홈`}>
      <Wordmark />
    </Link>
  )
}

export function RootLayout() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  async function signOut() {
    setBusy(true)
    setError(false)
    try {
      const { error } = await getSupabase().auth.signOut({ scope: 'local' })
      if (error) throw error
      void navigate('/', { replace: true })
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <a
        href="#main-content"
        className="skip-link"
        onClick={(event) => {
          // Keeping the fragment intact matters on single-use invitation URLs.
          event.preventDefault()
          const main = document.getElementById('main-content')
          if (main) {
            main.tabIndex = -1
            main.focus()
          }
        }}
      >
        본문 바로가기
      </a>
      <header className="site-header">
        <div className="container site-nav">
          <BrandLink />
          <nav className="main-nav" aria-label="주 메뉴">
            <NavLink to="/explore">프로젝트 탐색</NavLink>
            <NavLink to="/opportunities">협업 모집</NavLink>
            <NavLink to="/research">품앗이</NavLink>
            <NavLink to="/archive">경험 아카이브</NavLink>
            {session && <NavLink to="/dashboard">내 프로젝트</NavLink>}
          </nav>
          <div className="nav-actions">
            {!loading &&
              (session ? (
                <>
                  <Button asChild variant="ghost">
                    <Link to="/settings" aria-label="계정 설정" title="계정 설정">
                      <UserRound size={18} aria-hidden="true" />
                      <span className="nav-text">계정 설정</span>
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label="로그아웃"
                    title="로그아웃"
                    disabled={busy}
                    onClick={() => void signOut()}
                  >
                    <LogOut size={18} aria-hidden="true" />
                    <span className="nav-text">로그아웃</span>
                  </Button>
                </>
              ) : (
                <>
                  <Button asChild variant="ghost">
                    <Link to="/login">로그인</Link>
                  </Button>
                  <Button asChild>
                    <Link to="/signup">회원가입</Link>
                  </Button>
                </>
              ))}
          </div>
        </div>
      </header>
      {error && (
        <div className="container section-gap">
          <Notice kind="error">로그아웃하지 못했습니다. 다시 시도해 주세요.</Notice>
        </div>
      )}
      <div className="site-body">
        <Outlet />
      </div>
      <footer className="site-footer">
        <div className="container footer-content">
          <Wordmark />
          <p className="footer-note">
            <Info size={16} aria-hidden="true" /> 독립 프로젝트 · 대학 공식 서비스가 아닙니다.
          </p>
        </div>
      </footer>
    </>
  )
}
