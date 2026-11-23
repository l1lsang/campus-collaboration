import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { categoryLabel } from '../../lib/constants/brand'
import type { ProjectSummary } from './project-api'

const stateLabels: Record<ProjectSummary['status'], string> = {
  active: '진행 중',
  completed: '완료',
  paused: '중단',
  archived: '보관',
}

export function ProjectCard({ project, role }: { project: ProjectSummary; role?: string }) {
  return (
    <li className="project-row">
      <Link to={`/projects/${project.id}`} className="project-row-link">
        <div className="project-row-content">
          <h3>{project.title}</h3>
          <p className="project-summary">{project.description}</p>
          <p className="project-row-meta">
            <span>{categoryLabel(project.category)}</span>
            {role && (
              <span>
                {project.visibility === 'private' ? '비공개' : '공개'} ·{' '}
                {role === 'owner' ? '팀장' : '팀원'}
              </span>
            )}
            {project.due_date && (
              <span>
                마감{' '}
                <time dateTime={project.due_date}>{project.due_date.replaceAll('-', '.')}</time>
              </span>
            )}
          </p>
        </div>
        <span className="project-row-status">{stateLabels[project.status]}</span>
        <ArrowRight size={18} className="project-row-arrow" aria-hidden="true" />
      </Link>
    </li>
  )
}
