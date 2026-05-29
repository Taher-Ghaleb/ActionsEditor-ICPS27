// ============================================================
// GitHub Actions Constants
// All dropdown options, known actions, permission values, etc.
// ============================================================

export const TRIGGERS = [
  { value: 'push',                       label: 'push' },
  { value: 'pull_request',               label: 'pull_request' },
  { value: 'pull_request_target',        label: 'pull_request_target' },
  { value: 'workflow_dispatch',          label: 'workflow_dispatch' },
  { value: 'workflow_call',              label: 'workflow_call' },
  { value: 'workflow_run',               label: 'workflow_run' },
  { value: 'schedule',                   label: 'schedule' },
  { value: 'release',                    label: 'release' },
  { value: 'create',                     label: 'create' },
  { value: 'delete',                     label: 'delete' },
  { value: 'fork',                       label: 'fork' },
  { value: 'issues',                     label: 'issues' },
  { value: 'issue_comment',              label: 'issue_comment' },
  { value: 'label',                      label: 'label' },
  { value: 'milestone',                  label: 'milestone' },
  { value: 'pull_request_review',        label: 'pull_request_review' },
  { value: 'pull_request_review_comment',label: 'pull_request_review_comment' },
  { value: 'check_run',                  label: 'check_run' },
  { value: 'check_suite',               label: 'check_suite' },
  { value: 'deployment',                label: 'deployment' },
  { value: 'deployment_status',         label: 'deployment_status' },
  { value: 'page_build',                label: 'page_build' },
  { value: 'public',                    label: 'public' },
  { value: 'registry_package',          label: 'registry_package' },
  { value: 'repository_dispatch',       label: 'repository_dispatch' },
  { value: 'status',                    label: 'status' },
  { value: 'watch',                     label: 'watch' },
  { value: 'gollum',                    label: 'gollum (wiki)' },
  { value: 'discussion',                label: 'discussion' },
  { value: 'discussion_comment',        label: 'discussion_comment' },
  { value: 'merge_group',               label: 'merge_group' },
]

export const RUNNERS = [
  'ubuntu-latest',
  'ubuntu-24.04',
  'ubuntu-22.04',
  'ubuntu-20.04',
  'windows-latest',
  'windows-2022',
  'windows-2019',
  'macos-latest',
  'macos-14',
  'macos-13',
  'macos-12',
  'self-hosted',
]

export const SHELLS = ['bash', 'sh', 'pwsh', 'powershell', 'python', 'cmd']

export const PERMISSIONS = [
  'actions', 'checks', 'contents', 'deployments',
  'discussions', 'id-token', 'issues', 'packages',
  'pages', 'pull-requests', 'repository-projects',
  'security-events', 'statuses',
]

export const PERMISSION_VALUES = ['read', 'write', 'none']

export const COMMON_ACTIONS = [
  'actions/checkout@v4',
  'actions/checkout@v3',
  'actions/setup-node@v4',
  'actions/setup-node@v3',
  'actions/setup-python@v5',
  'actions/setup-python@v4',
  'actions/setup-java@v4',
  'actions/setup-go@v5',
  'actions/setup-dotnet@v4',
  'actions/setup-ruby@v1',
  'actions/cache@v4',
  'actions/cache@v3',
  'actions/upload-artifact@v4',
  'actions/download-artifact@v4',
  'actions/github-script@v7',
  'actions/deploy-pages@v4',
  'actions/configure-pages@v5',
  'actions/upload-pages-artifact@v3',
  'actions/first-interaction@v1',
  'actions/stale@v9',
  'actions/labeler@v5',
  'docker/login-action@v3',
  'docker/build-push-action@v5',
  'docker/metadata-action@v5',
  'docker/setup-buildx-action@v3',
  'docker/setup-qemu-action@v3',
  'aws-actions/configure-aws-credentials@v4',
  'aws-actions/amazon-ecr-login@v2',
  'azure/login@v1',
  'azure/webapps-deploy@v2',
  'google-github-actions/auth@v2',
  'google-github-actions/deploy-appengine@v2',
  'github/codeql-action/init@v3',
  'github/codeql-action/autobuild@v3',
  'github/codeql-action/analyze@v3',
  'softprops/action-gh-release@v2',
  'peaceiris/actions-gh-pages@v4',
  'codecov/codecov-action@v4',
  'sonarsource/sonarcloud-github-action@master',
  'JamesIves/github-pages-deploy-action@v4',
  'peter-evans/create-pull-request@v6',
  'peter-evans/find-comment@v3',
  'peter-evans/create-or-update-comment@v4',
  'EndBug/add-and-commit@v9',
  'stefanzweifel/git-auto-commit-action@v5',
  'nick-invision/retry@v2',
  'dawidd6/action-download-artifact@v3',
]

export const RELEASE_TYPES = [
  'published', 'unpublished', 'created', 'edited',
  'deleted', 'prereleased', 'released',
]

export const ISSUE_TYPES = [
  'opened', 'edited', 'deleted', 'transferred',
  'pinned', 'unpinned', 'closed', 'reopened',
  'assigned', 'unassigned', 'labeled', 'unlabeled',
  'locked', 'unlocked', 'milestoned', 'demilestoned',
]

export const PR_TYPES = [
  'opened', 'edited', 'closed', 'synchronize',
  'reopened', 'assigned', 'unassigned', 'labeled',
  'unlabeled', 'ready_for_review', 'locked', 'unlocked',
  'converted_to_draft', 'review_requested', 'review_request_removed',
  'auto_merge_enabled', 'auto_merge_disabled',
]
