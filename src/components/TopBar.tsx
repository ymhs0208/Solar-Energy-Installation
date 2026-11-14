import { ArrowLeft, ArrowUpRight, Sun } from 'lucide-react';
import { Link, NavLink, useLocation } from 'react-router-dom';

interface TopBarProps {
  hasActiveCase?: boolean;
}

const navItems = [
  { path: '/', label: '案場評估' },
  { path: '/report', label: '可行性報告' },
  { path: '/epc', label: 'EPC 媒合' },
  { path: '/methodology', label: '演算法與來源' },
];

export function TopBar({ hasActiveCase = false }: TopBarProps) {
  const { pathname } = useLocation();
  const isReport = pathname === '/report';

  return (
    <header className="app-header no-print">
      <div className="app-header-inner">
        <Link to="/" className="app-brand">
          <span className="app-brand-icon"><Sun size={21} aria-hidden="true" /></span>
          <span>SolarX <span className="app-brand-ai">AI</span></span>
        </Link>

        <nav aria-label="主導覽列" className="app-nav">
          {navItems.map(({ path, label }) => (
            <NavLink key={path} to={path} end>{label}</NavLink>
          ))}
        </nav>

        <Link to={isReport ? '/' : '/report'} className="app-header-action">
          {isReport && <ArrowLeft size={15} aria-hidden="true" />}
          {isReport ? '返回案場調整' : hasActiveCase ? '檢視可行性報告' : '前往報告頁'}
          {!isReport && <ArrowUpRight size={15} aria-hidden="true" />}
        </Link>
      </div>
    </header>
  );
}
