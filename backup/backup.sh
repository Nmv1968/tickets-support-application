#!/bin/sh
# Backs up the support app into /backups, a folder of the machine that runs Docker:
#   soporte-YYYY-MM-DD.dump  the database as it stood at the last backup of that day
#   adjuntos/                a copy of every attachment
#
# Runs for ever: one backup when the container starts, so a machine that was off catches up,
# then one every BACKUP_INTERVAL_HOURS. "backup.sh once" makes a single backup and ends.
#
# The connection comes from the PG* variables set in docker-compose.yml.
set -u

DIR=/backups
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-6}"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $*"
}

backup() {
  day=$(date +%F)
  file="$DIR/soporte-$day.dump"
  tmp="$file.tmp"

  # Written beside its final name and moved there once complete: a dump cut short never takes
  # the place of a good one.
  if ! pg_dump --format=custom --no-owner --file="$tmp"; then
    rm -f "$tmp"
    log "ERROR: no se pudo leer la base de datos. Los respaldos anteriores se conservan."
    return 1
  fi
  # A dump that cannot be listed cannot be restored.
  if ! pg_restore --list "$tmp" > /dev/null; then
    rm -f "$tmp"
    log "ERROR: el respaldo de la base de datos salió dañado. Los respaldos anteriores se conservan."
    return 1
  fi
  mv -f "$tmp" "$file"

  # An attachment never changes once stored, so only the new ones are copied. One deleted in
  # the app stays in the copy: a backup that forgot what was deleted could not bring it back.
  # Only the files of the folder itself: the attachments. The folder .incoming inside it holds
  # uploads still arriving, which are no attachment yet and may never be one.
  mkdir -p "$DIR/adjuntos"
  if ! find /data/uploads -maxdepth 1 -type f -exec sh -c 'cp -u "$@" "$0"' "$DIR/adjuntos/" {} +; then
    log "ERROR: no se pudieron copiar los adjuntos. La base de datos sí quedó respaldada en $(basename "$file")."
    return 1
  fi

  # Old dumps go only now, with a new one safely in place.
  find "$DIR" -maxdepth 1 -name 'soporte-*.dump' -mtime +"$KEEP_DAYS" -exec rm -f {} +

  log "Respaldo listo: $(basename "$file") ($(du -h "$file" | cut -f1)). Adjuntos copiados: $(find "$DIR/adjuntos" -type f | wc -l). Días con respaldo: $(find "$DIR" -maxdepth 1 -name 'soporte-*.dump' | wc -l)."
}

if [ "${1:-}" = "once" ]; then
  backup
  exit $?
fi

# The shell is process 1 of the container and would ignore the stop signal of `docker stop`.
trap 'exit 0' TERM INT

log "Respaldos en la carpeta de respaldos: uno ahora y luego cada $INTERVAL_HOURS h. Se conservan $KEEP_DAYS días."
while true; do
  if backup; then
    pause=$((INTERVAL_HOURS * 3600))
  else
    # Tried again soon: the database may have been restarting.
    pause=600
  fi
  # In the background and waited for, so the stop signal is not held until the pause ends.
  sleep "$pause" &
  wait $!
done
