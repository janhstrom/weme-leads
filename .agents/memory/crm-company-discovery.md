---
name: CRM company discovery
description: Safe matching when CRM contact company fields contain domains or full-name search returns no results.
---

CRM discovery may need to search by full legal name, exact candidate domain, and a short company-name token. Treat a domain-like CRM `company` value as a domain candidate, but only accept the result after exact organization-number, normalized-domain, or normalized-name matching.

**Why:** The CRM stores companies indirectly on contacts, and imported records can put a hostname in `company`. Its search may return nothing for a full legal name while returning the correct contacts for the exact domain or a shorter term.

**How to apply:** Keep broad search terms as discovery only. Never let a partial search term itself establish the match; run the existing uniqueness and exact-match checks over the returned contacts.