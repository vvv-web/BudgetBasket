-- Read-only report to run before Alembic revision 20260731_0020.
-- Resolve every conflict row before applying the migration.

\echo '1. CFOs whose modules have different active economists'
SELECT cfo.id AS cfo_id, cfo.name AS cfo_name,
       array_agg(DISTINCT economist.login ORDER BY economist.login) AS economists
FROM units module
JOIN units cfo ON cfo.id = module.parent_id
JOIN units_responsibles assignment
  ON assignment.unit_id = module.id AND assignment.is_active
JOIN users economist ON economist.id = assignment.user_id
JOIN roles role ON role.id = economist.id_role AND role.name = 'economist'
WHERE NOT EXISTS (
    SELECT 1 FROM units child WHERE child.parent_id = module.id
)
GROUP BY cfo.id, cfo.name
HAVING count(DISTINCT economist.id) > 1;

\echo '2. Modules with more than one request in a calendar year'
SELECT request.unit_id, unit.name AS module_name,
       EXTRACT(YEAR FROM request.created_at)::integer AS budget_year,
       count(*) AS requests_count,
       array_agg(request.id ORDER BY request.created_at) AS request_ids
FROM requests request
JOIN units unit ON unit.id = request.unit_id
GROUP BY request.unit_id, unit.name, EXTRACT(YEAR FROM request.created_at)
HAVING count(*) > 1;

\echo '3. Missing module/CFO assignments'
WITH user_roles AS (
    SELECT assignment.unit_id, role.name AS role_name
    FROM units_responsibles assignment
    JOIN users account ON account.id = assignment.user_id
    JOIN roles role ON role.id = account.id_role
    WHERE assignment.is_active
)
SELECT cfo.id AS cfo_id, cfo.name AS cfo_name,
       module.id AS module_id, module.name AS module_name,
       NOT EXISTS (
           SELECT 1 FROM user_roles
           WHERE unit_id = module.id AND role_name = 'employee'
       ) AS missing_module_responsible,
       NOT EXISTS (
           SELECT 1 FROM user_roles
           WHERE unit_id = cfo.id AND role_name = 'employee'
       ) AS missing_cfo_responsible,
       NOT EXISTS (
           SELECT 1 FROM user_roles
           WHERE unit_id IN (
               SELECT child.id FROM units child WHERE child.parent_id = cfo.id
           ) AND role_name = 'economist'
       ) AS missing_cfo_economist_source
FROM units module
JOIN units cfo ON cfo.id = module.parent_id
WHERE NOT EXISTS (
          SELECT 1 FROM units nested WHERE nested.parent_id = module.id
      )
  AND (
      NOT EXISTS (
          SELECT 1 FROM user_roles
          WHERE unit_id = module.id AND role_name = 'employee'
      )
   OR NOT EXISTS (
          SELECT 1 FROM user_roles
          WHERE unit_id = cfo.id AND role_name = 'employee'
      )
   OR NOT EXISTS (
          SELECT 1 FROM user_roles
          WHERE unit_id IN (
              SELECT child.id FROM units child WHERE child.parent_id = cfo.id
          ) AND role_name = 'economist'
      )
  );

\echo '4. CFOs whose module leaf steps have incompatible parent routes'
WITH leaf_routes AS (
    SELECT cfo.id AS cfo_id, cfo.name AS cfo_name,
           module.id AS module_id, module.name AS module_name,
           leaf.id AS step_id,
           COALESCE(
               array_agg(edge.parent_step_id::text ORDER BY edge.parent_step_id)
                   FILTER (WHERE edge.parent_step_id IS NOT NULL),
               ARRAY[]::text[]
           ) AS parent_step_ids,
           EXISTS (
               SELECT 1 FROM step_edges child_edge
               WHERE child_edge.parent_step_id = leaf.id
           ) AS is_not_really_leaf
    FROM steps leaf
    JOIN units module ON module.id = leaf.unit_id
    JOIN units cfo ON cfo.id = module.parent_id
    LEFT JOIN step_edges edge ON edge.child_step_id = leaf.id
    WHERE NOT EXISTS (
        SELECT 1 FROM units child WHERE child.parent_id = module.id
    )
    GROUP BY cfo.id, cfo.name, module.id, module.name, leaf.id
),
conflicted_cfos AS (
    SELECT cfo_id
    FROM leaf_routes
    GROUP BY cfo_id
    HAVING count(DISTINCT parent_step_ids::text) > 1 OR bool_or(is_not_really_leaf)
)
SELECT route.*
FROM leaf_routes route
JOIN conflicted_cfos conflict ON conflict.cfo_id = route.cfo_id
ORDER BY route.cfo_name, route.module_name;
