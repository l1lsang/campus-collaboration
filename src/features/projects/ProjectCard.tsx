import { ArrowUpRight, Folder, LockKeyhole, Globe2 } from 'lucide-react'
import { Link } from 'react-router'
import { categoryLabel } from '../../lib/constants/brand'
import type { ProjectSummary } from './project-api'

export function ProjectCard({ project, role }: { project: ProjectSummary; role?: string }) {
  return (
    <li className="project-card">
      <Link to={`/projects/${project.id}`} className="project-card-link">
        <div className="project-card-top">
          <span className="project-icon">
            <Folder size={19} aria-hidden="true" />
          </span>
          <ArrowUpRight size={18} aria-hidden="true" />
        </div>
        <span className="chip">{categoryLabel(project.category)}</span>
        <h3>{project.title}</h3>
        <p className="project-summary">{project.description}</p>
        <div className="project-card-meta">
          {project.visibility === 'private' ? (
            <LockKeyhole size={15} aria-hidden="true" />
          ) : (
            <Globe2 size={15} aria-hidden="true" />
          )}
          {project.visibility === 'private' ? '비공개' : '공개'}
          {role && <span>· {role === 'owner' ? '팀장' : '팀원'}</span>}
        </div>
      </Link>
    </li>
  )
}
