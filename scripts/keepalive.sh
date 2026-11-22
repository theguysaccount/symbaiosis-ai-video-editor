#!/usr/bin/env bash
# Keep the scheduled workflows running. GitHub disables schedules in a public repository after
# 60 days without a commit. This re-enables every workflow on each run (a no-op while they are
# enabled; never touches one that a person disabled by hand) and, once the last commit is 45 days
# old, pushes an empty commit. Pushes made with the workflow token start no other workflow.
# Needs: GH_TOKEN, GITHUB_REPOSITORY, and permissions "actions: write" and "contents: write".
set -euo pipefail

gh api "repos/$GITHUB_REPOSITORY/actions/workflows" --jq '.workflows[] | [.id, .state, .path] | @tsv' |
while IFS=$'\t' read -r id state wfpath; do
  if [ "$state" = "disabled_manually" ]; then
    echo "left alone (disabled by hand): $wfpath"
  elif gh api -X PUT "repos/$GITHUB_REPOSITORY/actions/workflows/$id/enable" >/dev/null 2>&1; then
    echo "enabled: $wfpath ($state)"
  else
    echo "::warning::could not re-enable $wfpath"
  fi
done

last=$(git log -1 --format=%ct)
age=$(( ( $(date +%s) - last ) / 86400 ))
echo "last commit: $age days ago"
if [ "$age" -ge 45 ]; then
  git config user.name "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git commit --allow-empty -m "keep-alive: $age days without a commit; scheduled workflows stay enabled"
  git push || echo "::warning::keep-alive push failed"
fi
