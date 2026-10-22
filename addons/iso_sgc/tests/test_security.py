from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, tagged


@tagged("post_install", "-at_install", "iso_sgc")
class TestSecurityInSharedInstance(TransactionCase):
    """The module lives in an Odoo shared with other apps: companies must stay isolated and
    only people in an ISO group may use it."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company_a = cls.env.company
        cls.company_b = cls.env["res.company"].create({"name": "Fertec test"})
        user_g = cls.env.ref("iso_sgc.group_iso_user")

        def mk(login, companies, groups):
            return cls.env["res.users"].with_context(no_reset_password=True).create(
                {
                    "name": login, "login": login, "email": f"{login}@example.com",
                    "company_id": companies[0].id,
                    "company_ids": [(6, 0, [c.id for c in companies])],
                    "group_ids": [(6, 0, groups.ids)],
                },
            )

        cls.user_a = mk("user_a", cls.company_a, user_g)
        cls.user_b = mk("user_b", cls.company_b, user_g)
        cls.user_both = mk("user_both", cls.company_a | cls.company_b, user_g)
        cls.no_iso = mk("no_iso", cls.company_a, cls.env.ref("base.group_user"))

    def _finding(self, company):
        return self.env["iso.finding"].create(
            {
                "company_id": company.id, "origin": "x", "type": "t", "process": "p",
                "description": "d", "owner_id": self.user_both.id,
            },
        )

    def test_company_isolation_finding(self):
        fa, fb = self._finding(self.company_a), self._finding(self.company_b)
        seen_a = self.env["iso.finding"].with_user(self.user_a).search([("id", "in", (fa | fb).ids)])
        seen_b = self.env["iso.finding"].with_user(self.user_b).search([("id", "in", (fa | fb).ids)])
        seen_both = self.env["iso.finding"].with_user(self.user_both).with_context(
            allowed_company_ids=(self.company_a | self.company_b).ids,
        ).search([("id", "in", (fa | fb).ids)])
        self.assertEqual(seen_a, fa)
        self.assertEqual(seen_b, fb)
        self.assertEqual(seen_both, fa | fb)
        with self.assertRaises(AccessError):
            fb.with_user(self.user_a).read(["name"])

    def test_company_isolation_special_release(self):
        r = self.env["iso.special.release"].create(
            {
                "company_id": self.company_b.id, "release_type": "raw_material",
                "deviation_description": "d", "client_impact": "i", "creator_id": self.user_b.id,
            },
        )
        self.assertFalse(self.env["iso.special.release"].with_user(self.user_a).search([("id", "=", r.id)]))
        self.assertTrue(self.env["iso.special.release"].with_user(self.user_b).search([("id", "=", r.id)]))

    def test_users_without_iso_group_have_no_access(self):
        with self.assertRaises(AccessError):
            self.env["iso.finding"].with_user(self.no_iso).search([])
        with self.assertRaises(AccessError):
            self.env["iso.special.release"].with_user(self.no_iso).search([])

    def test_sequences_are_shared_across_companies(self):
        n1 = self._finding(self.company_a).name
        n2 = self._finding(self.company_b).name
        self.assertNotEqual(n1, n2)
        self.assertEqual(int(n2.split("-")[1]), int(n1.split("-")[1]) + 1)

    def test_odoo_system_admins_are_iso_admins(self):
        sysadmin = self.env["res.users"].with_context(no_reset_password=True).create(
            {"name": "sys", "login": "sys", "email": "sys@example.com",
             "group_ids": [(6, 0, self.env.ref("base.group_system").ids)]},
        )
        self.assertTrue(sysadmin.has_group("iso_sgc.group_iso_admin"))
        self.assertFalse(self.user_a.has_group("iso_sgc.group_iso_admin"))
