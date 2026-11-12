# Same PostgreSQL version as the database service, so its dump tool matches the server.
FROM postgres:17-alpine
COPY backup.sh /usr/local/bin/backup.sh
# A checkout on Windows can give the script CRLF line ends, which sh does not accept.
RUN sed -i 's/\r$//' /usr/local/bin/backup.sh && chmod +x /usr/local/bin/backup.sh
# The image's own entrypoint starts a database server; this container only runs the script.
ENTRYPOINT []
CMD ["backup.sh"]
