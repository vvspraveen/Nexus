# Rule Breaker Organization Identity and Access Management Policy

Effective date: [01/01/2026]
Policy owner: [Harshitha Bandla and Sai Praveen]
Review cycle: At least annually
1. Purpose and Scope
This policy establishes requirements for authenticating users and managing access to Rule Breaker Organization systems and information. It applies to employees, contractors, vendors, service accounts, and other identities that access ABC resources.
Access must be authorized, limited to business need, and removed when no longer required.
2. Roles and Responsibilities
Identity and Access Management (IAM) / Security: Manage identity and authentication controls, maintain access records, and oversee exceptions.
Managers and sponsors: Request and review access for their employees and sponsored third parties; notify IAM of role or status changes.
System and data owners: Approve access to resources they own and confirm access remains appropriate.
HR and vendor-management functions: Provide timely, authorized notifications of workforce and third-party status changes.
Users: Protect their credentials, use only their assigned accounts, and promptly report suspected compromise or inappropriate access.
3. Account Provisioning
Access must be requested through an Rule Breaker-approved workflow and approved before it is granted. The request must identify the user, business need, requested resources, access level, and duration where applicable.
Rule Breaker must verify the requester’s identity and employment, contract, or sponsorship status using approved records and procedures before issuing access.
Each person must receive a unique account. Accounts must be associated with an identifiable user or accountable owner; redundant or unowned accounts are prohibited.
Access must be denied by default and granted using least privilege, need-to-know, and separation-of-duties principles. Role-based access should be used where practical.
Privileged access requires documented business justification and additional approval from the system owner and/or Security. It must be managed through Rule Breaker’s approved privileged-access controls, with multifactor authentication (MFA).
Third-party accounts must have a named Rule Breaker sponsor, defined purpose, approved access, and an expiration or review date. Access must be limited to the period needed and monitored.
Service accounts must have a documented owner, purpose, and scope; receive only the privileges required to operate; and use securely managed credentials. Credentials must not be embedded in source code or exposed in scripts or configuration files.
Shared, generic, or emergency accounts are permitted only by documented exception. Their use must be approved, time-limited where possible, securely managed, monitored, and attributable to an individual user.
4. Authentication
MFA must be used for user accounts wherever supported and is required for privileged access and remote access to Rule Breaker resources.
When used, must be unique and at least 16 characters long. Where a system cannot support 16 characters, a documented exception and compensating control are required.
Temporary or reset credentials must be unique and changed at first use. Users must not share credentials or store them in plain-text files or unapproved applications.
Authentication data must be protected during storage and transmission. Approved password-management tools may be used.
Systems must limit unsuccessful login attempts and require re-authentication after an idle period appropriate to the sensitivity of the resource. Rule Breaker’s proposed baseline is account lockout after no more than five unsuccessful attempts and re-authentication after 20 minutes of inactivity, subject to system capability and approved exceptions.
Before resetting credentials or authentication factors, the user’s identity must be verified through an approved process. Resets and changes must be logged.
Suspected or confirmed compromise requires prompt credential revocation or reset and review of affected sessions, tokens, and accounts.
5. Access Changes and Change Management
A change in job duties, business need, manager, contract status, or sponsorship must trigger a review of existing access.
Managers or sponsors must submit an access-change request promptly. The system owner must approve changes to access for their resource.
Access is no longer required and must be removed as part of the change. Rule Breaker should avoid retaining old access alongside new access unless there are a documented business need and approval.
Changes to IAM configurations, authentication settings, roles, or access-control rules must follow Rule Breaker’s approved change-management process. Changes must be authorized, tested where practical, documented, and logged. Emergency changes must receive a post-change review.
Requests to reset or replace authentication factors must follow identity-verification and approval procedures; lost or compromised factors must be revoked promptly.
6. Deprovisioning
Access must be revoked when a user’s employment, contract, sponsorship, or business need ends.
For urgent or high-risk terminations, access must be disabled immediately upon authorized notification. Otherwise, access must be disabled within 48 hours of notification, or sooner when required by Rule Breaker’s process.
Deprovisioning must cover applicable accounts, group memberships, privileged entitlements, remote access, active sessions, tokens, and third-party connections. Shared credentials or secrets known to the departing user must be rotated when warranted.
Accounts must be disabled or secured when no longer needed. Unassociated accounts must be investigated and disabled through the approved process.
Records and account data must be retained or removed under Rule Breaker’s applicable records-retention procedures; account deletion must not bypass those procedures.
Rule Breaker’s proposed baseline is to disable accounts after 30 days of inactivity and delete them after 365 days, unless an approved exception or retention requirement applies.
7. Access Reviews and Exceptions
Managers and system owners must review access regularly, including privileged and third-party access. Rule Breaker’s proposed baseline is quarterly review for privileged and contractor accounts, with other accounts reviewed at least annually and more frequently for high-criticality systems.
Exceptions must document the business justification, risk, compensating controls, approver, and expiration date. Exceptions must be reviewed before renewal. Suspected violations should be reported to.