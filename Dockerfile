# Odoo 19 Community with our addon baked in. Pin the exact image (digest) before production.
# Alternative: use your existing Odoo and just add ./addons to its addons_path.
ARG ODOO_IMAGE=odoo:19.0
FROM ${ODOO_IMAGE}
USER root
COPY addons/ /mnt/extra-addons/
RUN chown -R odoo:odoo /mnt/extra-addons
USER odoo
