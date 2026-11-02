BEGIN;
INSERT INTO "KnowledgeBaseCategory" ("companyId", name, slug, description, "sortOrder", "isPublic", "createdAt", "updatedAt") VALUES (1, 'About CES Tech', 'about-ces-tech', 'Who we are, our leadership, the industries we serve and our technology partners.', 1, true, now(), now()) ON CONFLICT ("companyId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Who is CES Tech?', 'who-is-ces-tech', 'CES Tech ("Beyond IT Services, We Deliver Solutions") is a technology partner that designs, secures and operates enterprise IT infrastructure. Our journey began in **2015**, driven by a passion for transforming IT infrastructure support.

We bring together expertise in:
- Enterprise networking and SD-WAN
- Cloud and hybrid cloud
- Cybersecurity and VAPT
- Data center and server & storage
- AI-driven operations and managed services

**By the numbers**
- 2356+ successful projects
- 675+ running projects
- 254+ skilled experts

Strategy, implementation and operations are delivered through one accountable CES team.

Head office: Assotech Business Cresterra, Tower-2, 9th Floor, Unit 901-902, Sector-135, Noida 201304, Uttar Pradesh.', 'CES Tech is an enterprise IT solutions company founded in 2015, with headquarters in Noida.', ARRAY['about','company','history','overview']::text[], true, 1, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'about-ces-tech' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Leadership team', 'leadership-team', '- **Suraj Soni** — Director (5× CCIE + CCDE)
- **Shaila Badar** — Chief Executive Officer
- **Sudeep Jain** — Chief Technology Officer
- **Arpit Agarwal** — Chief Financial Officer
- **Riyaz Siddique** — Head of Sales
- **Vipul Aggarwal** — Operation Head', 'The leaders who shape CES strategy, delivery and customer outcomes.', ARRAY['leadership','management','ceo','director','cto','founder']::text[], true, 2, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'about-ces-tech' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Industries we serve', 'industries-we-serve', 'CES Tech works with clients across major verticals, with industry-led solutions for:

- Financial Services
- Manufacturing
- Healthcare
- Telecom
- Media
- Retail
- Public Services

We work with conglomerates, enterprises and startups alike.', 'Financial services, manufacturing, healthcare, telecom, media, retail and public services.', ARRAY['industries','verticals','sectors','clients']::text[], true, 3, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'about-ces-tech' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Mission, vision and values', 'mission-vision-and-values', '**Mission** — Powered by a global team, we deliver smarter, better ways for all stakeholders through technology.

**Vision**
- Become the preferred technology partner for enterprises by delivering secure, intelligent and scalable solutions
- Continuously strengthen our engineering capabilities
- Foster a culture of learning, collaboration and growth
- Integrate Environmental, Social and Governance (ESG) principles into how we work
- Deliver sustainable growth through operational excellence and customer success

**Core values** — Integrity, Inclusion, Value Creation, People-Centricity and Social Responsibility.

**Our purpose** — bringing together the best of technology and people to supercharge progress for clients, people, communities and the planet.', 'What drives CES Tech: our mission, vision and core values.', ARRAY['mission','vision','values','culture','esg']::text[], true, 4, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'about-ces-tech' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Technology partners and clients', 'technology-partners-and-clients', '**Technology partners** include Cisco, Fortinet, Check Point, HPE, EnGenius and Hitachi. Our rental and delivery teams also work across Aruba, Juniper, Palo Alto, SonicWall, Dell, Lenovo and Cisco Meraki equipment.

**Clients and strategic partners** include Delhi Metro, Airtel, Vodafone and Hitachi.

See the full list on our [Partners page](https://www.ces-pl.com/partners).', 'CES works with Cisco, Fortinet, Check Point, HPE, EnGenius and more, and serves clients such as Delhi Metro, Airtel and Vodafone.', ARRAY['partners','oem','cisco','fortinet','hpe','checkpoint','clients']::text[], true, 5, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'about-ces-tech' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseCategory" ("companyId", name, slug, description, "sortOrder", "isPublic", "createdAt", "updatedAt") VALUES (1, 'Contact & Support', 'contact-support', 'How to reach us, support hours, response times and escalation.', 2, true, now(), now()) ON CONFLICT ("companyId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'How do I contact CES Tech?', 'how-do-i-contact-ces-tech', 'Email **info@ces-pl.com** or call **+91-0120-6911071**.

You can also use the form on our [Contact Us page](https://www.ces-pl.com/contact-us) — choose a topic (technical support, partner support, sales inquiry, training and certification, or general question) and we''ll get back to you.

For jobs, write to **hr@ces-pl.com**.', 'Email info@ces-pl.com or call +91-0120-6911071.', ARRAY['contact','phone','email','call','reach']::text[], true, 1, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'contact-support' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Office locations', 'office-locations', '**Noida Headquarters**
Assotech Business Cresterra, Tower-2, 9th Floor, Unit 901-902, Sector-135, Noida 201304, Uttar Pradesh

**Gurugram Office**
10th-11th Floor, Paras Trinity, Golf Course Ext Rd, Sector 63, Gurugram, Haryana 122011', 'Noida headquarters (Sector-135) and Gurugram office (Golf Course Ext Rd).', ARRAY['address','office','location','noida','gurugram','where']::text[], true, 2, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'contact-support' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Support and business hours', 'support-and-business-hours', '**Business support:** Monday – Friday, 9:30 AM – 6:30 PM (IST).

Our contact page also lists the team as reachable every day, 9:00 AM – 9:00 PM IST.

**Emergency and after-hours support** depends on your service agreement or AMC — check your contract or ask your Project Manager.', 'Business support runs Monday to Friday, 9:30 AM to 6:30 PM IST.', ARRAY['hours','timing','support hours','open','weekend']::text[], true, 3, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'contact-support' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'How do I raise a support request?', 'how-do-i-raise-a-support-request', 'Contact our support team by email, phone or the contact form on our website. Email **info@ces-pl.com** or call **+91-0120-6911071**.

To help us resolve your issue quickly, please include:
- Your name and company name
- Email address and contact number
- Project or service name
- A description of the issue
- Priority (Low / Medium / High / Critical)
- Screenshots or documents, if you have them

We help with network and security issues, server and storage, data center infrastructure, SD-WAN and wireless, cloud infrastructure, implementation and migration, and managed services (FMS, NOC, SOC).', 'Email, call or use the contact form, and include the details below so we can help quickly.', ARRAY['support','ticket','issue','problem','raise','complaint']::text[], true, 4, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'contact-support' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Support response times and escalation', 'support-response-times-and-escalation', 'Response times follow your contracted SLA. Typical targets:

- **Critical** — first response within 1 hour; resolution as per SLA
- **High** — first response within 4 business hours; resolution as per SLA
- **Medium** — first response within 1 business day; resolution in 2–3 business days
- **Low** — first response within 2 business days; resolution in 3–5 business days

Resolution times can vary with issue complexity and agreed service levels.

**If an issue isn''t resolved in time, escalate in this order:**
1. Service Coordinator / Project Coordinator
2. Project Manager
3. Delivery Manager
4. Customer Success / Management Team', 'Critical issues get a first response within 1 hour; resolution follows your signed SLA.', ARRAY['sla','response time','escalation','priority','resolution']::text[], true, 5, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'contact-support' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Do you provide onsite support?', 'do-you-provide-onsite-support', 'Yes. Onsite, remote, resident engineer and managed services are all available, based on the agreed scope of work.', 'Yes — onsite, remote, resident engineer and managed services, based on the agreed scope.', ARRAY['onsite','on-site','remote','resident engineer','field']::text[], true, 6, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'contact-support' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Project status updates and change requests', 'project-status-updates-and-change-requests', '**Status updates** — contact your assigned Project Manager or CES Tech support representative. For ongoing projects you can request status updates, implementation schedules, resource deployment information, documentation and reports, and completion/sign-off assistance.

**Additional work during a project** — yes, this can be done after a Change Request (CR) is approved, with a revised commercial agreement where applicable.', 'Ask your Project Manager for status; extra work goes through a Change Request.', ARRAY['project','status','update','change request','cr','schedule']::text[], true, 7, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'contact-support' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Billing and accounts', 'billing-and-accounts', 'Our finance team helps with:
- Invoice requests
- Payment confirmations
- Purchase Order (PO) queries
- Account statements
- Commercial clarifications

Email **info@ces-pl.com** or call **+91-0120-6911071**. Mention your company name and the invoice or PO number.', 'Invoices, payment confirmations, PO queries and account statements.', ARRAY['billing','invoice','payment','po','purchase order','accounts']::text[], true, 8, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'contact-support' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseCategory" ("companyId", name, slug, description, "sortOrder", "isPublic", "createdAt", "updatedAt") VALUES (1, 'Services', 'services', 'IT services, managed services, AMC, network audit, rental, VAPT and training.', 3, true, now(), now()) ON CONFLICT ("companyId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'IT Services', 'it-services', 'Our IT Services act as a complete operating layer for your business — keeping systems stable, protecting digital assets, supporting users and keeping infrastructure aligned with growth.

Coverage includes managed operations, cybersecurity, cloud enablement, consulting, software support, infrastructure management, data services and end-user assistance.

**What you get**
- **Enhanced security** — continuous monitoring, vulnerability checks and threat-focused controls
- **Increased efficiency** — less manual work through managed workflows and proactive maintenance
- **Cost savings** — predictable service models and less downtime
- **Access to expertise** — specialists across network, cloud, security and infrastructure
- **Scalability** — scale service capacity up or down as priorities change

[More about IT Services](https://www.ces-pl.com/services/it-services)', 'End-to-end IT operations: managed operations, security, cloud, consulting, infrastructure and end-user support.', ARRAY['it services','it support','outsourcing','consulting']::text[], true, 1, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'services' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Managed Services', 'managed-services', 'Managed Services hands routine IT responsibility to dedicated CES specialists who monitor, maintain, secure and optimise your environment — so your team can focus on the business.

- **Proactive monitoring** — detect and fix issues before users are affected
- **Broad coverage** — network, cybersecurity, backup, cloud and end-user environments under one model
- **Predictable cost** — fixed-fee subscription for easier budgeting
- **Fast issue resolution** — structured escalation to cut downtime
- **Latest technology** — current tools and practices without building a large in-house team
- **Security and continuity focus**

We also run FMS, NOC and SOC services. [More about Managed Services](https://www.ces-pl.com/services/managed-services)', 'We monitor, maintain, secure and optimise your IT environment on a predictable subscription.', ARRAY['managed services','msp','noc','soc','fms','monitoring','outsourcing']::text[], true, 2, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'services' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Annual Maintenance Contract (AMC)', 'annual-maintenance-contract-amc', 'An AMC keeps your IT infrastructure and business-critical equipment healthy through scheduled inspections, preventive servicing and timely repairs.

- **Regular preventive maintenance** — catch issues before they cause failures
- **Priority service support** — faster help and less downtime when faults occur
- **Cost control** — a planned annual cost instead of unpredictable repairs
- **Expert technicians** familiar with your devices
- **Compliance and warranty alignment**
- **Longer equipment life**

Emergency support coverage depends on your AMC terms. [More about AMC](https://www.ces-pl.com/services/annual-maintenance-contract)', 'A yearly agreement for preventive and corrective maintenance of your IT infrastructure.', ARRAY['amc','annual maintenance','maintenance','repair','warranty']::text[], true, 3, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'services' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Network Audit', 'network-audit', 'A Network Audit gives you a detailed current-state baseline so you can see exactly where risk, inefficiency and bottlenecks are.

- **Infrastructure examination** — routers, switches, firewalls, links and topology across branch, campus and core
- **Performance benchmarking** — throughput, utilisation, latency and packet behaviour
- **Security and control review** — segmentation, access controls and policy quality
- **Configuration accuracy** — drift and gaps between intended design and what''s deployed
- **Risk prioritisation** — findings ranked by business impact
- **Actionable remediation plan**

[More about Network Audit](https://www.ces-pl.com/services/network-audit)', 'A full review of your network''s devices, design, performance and security, with a remediation plan.', ARRAY['network audit','assessment','review','health check']::text[], true, 4, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'services' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'IT equipment rental', 'it-equipment-rental', 'Use enterprise-grade IT equipment without buying it — ideal for events, projects, new branches or temporary capacity.

**Rental fleet**
- Routers & switches — Cisco, Juniper, Aruba
- Firewalls & UTM — Fortinet, Palo Alto, SonicWall
- Servers & storage — Dell, HPE, Lenovo
- Wireless — Wi-Fi 6 access points and controllers
- Video conferencing — Cisco Webex, Poly rooms

**Lease terms:** daily, weekly, monthly or annual. Insurance and logistics are included, and it''s a pure OPEX model — no capital spend.

**How it works**
1. Requirement brief — scope, duration and site details
2. Equipment staging — pre-configured and tested
3. Deploy & support — on-site installation, with 24/7 support during events
4. Return & audit

[More about Rental](https://www.ces-pl.com/services/rental)', 'Rent routers, switches, firewalls, servers, Wi-Fi and video conferencing gear — daily, weekly, monthly or annually.', ARRAY['rental','rent','lease','hire','event','temporary','equipment']::text[], true, 5, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'services' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'VAPT (Vulnerability Assessment and Penetration Testing)', 'vapt-vulnerability-assessment-and-penetration-testing', 'VAPT combines systematic vulnerability analysis with controlled penetration attempts, so you understand both theoretical and real-world security exposure.

- **Vulnerability discovery** across applications, infrastructure and exposed network surfaces
- **Penetration simulation** — test how weaknesses could actually be exploited
- **Risk classification** by severity, exploitability and business impact
- **Remediation guidance** to close gaps quickly
- **Compliance support** with documented assessment outputs
- **Continuous security improvement** through repeat hardening cycles

[More about VAPT](https://www.ces-pl.com/services/vapt)', 'Find, validate and fix exploitable security weaknesses in your systems.', ARRAY['vapt','penetration testing','pentest','vulnerability','security audit']::text[], true, 6, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'services' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Training and workshops', 'training-and-workshops', 'CES Tech offers:
- Corporate trainings
- Onsite technical workshops
- Partner enablement

To plan a session, pick **Training and certification** as the topic on our [Contact Us page](https://www.ces-pl.com/contact-us), or email **info@ces-pl.com** or call **+91-0120-6911071**.', 'Corporate trainings, onsite technical workshops and partner enablement.', ARRAY['training','workshop','certification','course','enablement']::text[], true, 7, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'services' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseCategory" ("companyId", name, slug, description, "sortOrder", "isPublic", "createdAt", "updatedAt") VALUES (1, 'Solutions', 'solutions', 'Network, cloud, security, data center and collaboration solutions.', 4, true, now(), now()) ON CONFLICT ("companyId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'SD-WAN', 'sd-wan', 'SD-WAN separates control from hardware and gives you centralised visibility and policy management across all your sites.

- Centralised WAN management
- Application-aware traffic routing
- Better branch resilience and rapid branch rollout

Replacing costly MPLS with SD-WAN can reduce WAN costs by 30–50%. [More about SD-WAN](https://www.ces-pl.com/solutions/sd-wan-solution)', 'Centralised WAN control with application-aware routing — a cost-effective alternative to MPLS.', ARRAY['sd-wan','sdwan','wan','mpls','branch']::text[], true, 1, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'solutions' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Cloud and hybrid cloud', 'cloud-and-hybrid-cloud', 'We design scalable cloud architecture across SaaS, PaaS and IaaS models to improve agility and simplify infrastructure ownership.

- Hybrid cloud architecture — on-premises control with cloud agility
- Elastic scaling
- Modernised application delivery
- Assessment, migration planning and managed operations

[More about Cloud](https://www.ces-pl.com/solutions/cloud-solution)', 'Cloud solutions across SaaS, PaaS and IaaS, including hybrid cloud and migration.', ARRAY['cloud','hybrid cloud','migration','aws','azure','iaas','saas']::text[], true, 2, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'solutions' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Network security', 'network-security', 'A layered network security approach that protects users, devices, applications and traffic.

- Threat prevention with next-generation firewalls and intrusion prevention
- Access governance and segmentation
- Continuous security monitoring
- Risk assessment, hardening and ongoing threat management, designed for compliance

[More about Network Security](https://www.ces-pl.com/solutions/network-security-solution)', 'Layered protection with next-gen firewalls, segmentation and continuous monitoring.', ARRAY['network security','firewall','ngfw','segmentation','ips']::text[], true, 3, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'solutions' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Cyber security', 'cyber-security', 'Holistic protection across infrastructure, applications and users.

- Defence-in-depth strategy
- Threat detection and response
- Security governance and risk reduction
- Coverage across network, endpoint, cloud and identity (IAM)

[More about Cyber Security](https://www.ces-pl.com/solutions/cyber-security)', 'Defence-in-depth across network, endpoint, cloud, identity and incident response.', ARRAY['cyber security','cybersecurity','zero trust','endpoint','iam','soc']::text[], true, 4, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'solutions' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Enterprise networking', 'enterprise-networking', 'Enterprise network design and operations that support performance, resilience, secure access and growth across campus, branch and remote environments.

- Enterprise-grade architecture
- Scalable connectivity
- Secure, reliable operations

[More about Enterprise Network](https://www.ces-pl.com/solutions/enterprise-network-solution)', 'Secure, scalable networks across campus, branch and remote sites.', ARRAY['enterprise network','lan','campus','switching','routing']::text[], true, 5, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'solutions' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Data center', 'data-center', 'Integrated data center architecture spanning compute, storage, networking, security and operations.

- Scalable architecture design
- High availability and continuity, with rapid failover
- Modernisation to improve performance and cut energy costs

[More about Data Center](https://www.ces-pl.com/solutions/data-center-solution)', 'Reliable, scalable data center foundations for critical workloads.', ARRAY['data center','datacenter','dc','high availability','modernization']::text[], true, 6, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'solutions' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Cisco ACI', 'cisco-aci', 'Application-centric infrastructure with centralised control to simplify provisioning and keep policy consistent.

- Policy-based fabric control
- Centralised, APIC-driven operations
- Automated, secure segmentation

[More about ACI](https://www.ces-pl.com/solutions/aci-solution)', 'Policy-driven data center networking and automation with Cisco ACI.', ARRAY['aci','cisco aci','apic','sdn','fabric']::text[], true, 7, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'solutions' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Server and storage', 'server-and-storage', 'Enterprise server and storage environments to support business-critical applications and data.

- Integrated compute and storage stack
- Data availability and protection
- Infrastructure lifecycle support

[More about Server & Storage](https://www.ces-pl.com/solutions/server-storage-solution)', 'Compute and storage platforms built for performance, reliability and growth.', ARRAY['server','storage','san','nas','backup','compute']::text[], true, 8, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'solutions' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Mobility and wireless', 'mobility-and-wireless', 'Wireless and mobility architecture for BYOD, branch and campus access, and connected operations.

- Enterprise Wi-Fi and mobility design
- Support for mobile-first operations
- A better access experience for users

[More about Mobility & Wireless](https://www.ces-pl.com/solutions/mobility-wireless-solution)', 'Enterprise Wi-Fi and mobility for BYOD, campus and branch access.', ARRAY['wireless','wifi','wi-fi','mobility','byod','access point']::text[], true, 9, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'solutions' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Voice and video collaboration', 'voice-and-video-collaboration', 'Real-time communication and collaboration for distributed teams, replacing legacy telephony.

- Unified communication experience
- Reliable conferencing and VoIP
- Better team collaboration, with security and integration into existing systems

[More about Voice & Video](https://www.ces-pl.com/solutions/voice-video-solution)', 'Unified communications, VoIP and conferencing for distributed teams.', ARRAY['voice','video','voip','unified communications','conferencing','webex']::text[], true, 10, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'solutions' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Network consulting', 'network-consulting', 'A consulting-led engagement to assess your current network, define a target design and get it ready for your business goals.

- Architecture and roadmap advisory
- Performance and security optimisation
- Technology transition planning

[More about Network Consulting](https://www.ces-pl.com/solutions/network-consulting)', 'Expert advice on network architecture, optimisation, transformation and troubleshooting.', ARRAY['consulting','advisory','architecture','design','roadmap']::text[], true, 11, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'solutions' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseCategory" ("companyId", name, slug, description, "sortOrder", "isPublic", "createdAt", "updatedAt") VALUES (1, 'Sales & Projects', 'sales-projects', 'Quotations, consultations and how we deliver projects.', 5, true, now(), now()) ON CONFLICT ("companyId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'How do I get a quotation or free consultation?', 'how-do-i-get-a-quotation-or-free-consultation', 'Submit your requirements through our [Contact Us page](https://www.ces-pl.com/contact-us) (topic: **Sales inquiry**), or email **info@ces-pl.com** or call **+91-0120-6911071**.

**What happens next**
1. **Tell us your vision** — share your goals and project context
2. **Free consultation** — our specialists define scope, technology, timelines and an execution plan
3. **Detailed proposal** — a transparent technical and delivery proposal with milestones and ownership

Pricing depends on scope, so our team will confirm it in the proposal. Our sales team handles product enquiries, service quotations, solution consulting, AMC, managed and professional services.', 'Share your requirements on the Contact Us page or email info@ces-pl.com.', ARRAY['quote','quotation','pricing','price','cost','consultation','proposal','demo']::text[], true, 1, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'sales-projects' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'How CES delivers a project', 'how-ces-delivers-a-project', 'We follow a transparent, collaborative process:

1. **Discovery** — we learn your business, users and goals, then build a clear roadmap
2. **Design** — designs and prototypes you can review before build
3. **Build & test** — quality checks and regular demos so you always know where things stand
4. **Ship & support** — we launch, monitor and keep improving; post-launch support is included

Every engagement has one accountable CES team from planning to support.', 'Discovery, design, build and test, then ship and support.', ARRAY['process','methodology','delivery','implementation','project']::text[], true, 2, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'sales-projects' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseCategory" ("companyId", name, slug, description, "sortOrder", "isPublic", "createdAt", "updatedAt") VALUES (1, 'Careers', 'careers', 'Jobs, internships and applications at CES Tech.', 6, true, now(), now()) ON CONFLICT ("companyId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'How do I apply for a job at CES Tech?', 'how-do-i-apply-for-a-job-at-ces-tech', 'Browse open roles and apply on our [careers page](https://mira.ces-pl.com/careers/MQ%3D%3D), or email your resume to **hr@ces-pl.com**.

Our HR team can help with current openings, internships, the recruitment process and your application status.', 'Apply on our careers page or email your resume to hr@ces-pl.com.', ARRAY['job','career','apply','vacancy','opening','hiring','resume']::text[], true, 1, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'careers' ON CONFLICT ("categoryId", slug) DO NOTHING;
INSERT INTO "KnowledgeBaseArticle" ("categoryId", title, slug, content, excerpt, tags, "isPublished", "sortOrder", "createdAt", "updatedAt") SELECT c.id, 'Internships and application status', 'internships-and-application-status', 'For internship opportunities, or to check the status of an application, email **hr@ces-pl.com** with your name and the role you applied for.

You can also learn more about working with us on [Life at CES](https://www.ces-pl.com/life-at-ces).', 'Ask HR about internships or where your application stands.', ARRAY['internship','intern','fresher','application status','interview']::text[], true, 2, now(), now() FROM "KnowledgeBaseCategory" c WHERE c."companyId" = 1 AND c.slug = 'careers' ON CONFLICT ("categoryId", slug) DO NOTHING;
COMMIT;
