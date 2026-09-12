/* assets/k8s-inspector/rules.js
 * Rule table — hand-maintained. Nothing generates this file; adding a check
 * means adding an entry here, not editing inspect.js.
 *
 * Every finding names a release or a concrete setting the reader can check. A
 * rule that guesses is worse than a rule that is absent: this page tells people
 * their manifest is wrong, and it has to be right when it does.
 *
 * v2, deliberately out of scope: manifest diffing, per-rule on/off, share-by-link.
 */
(function (global) {
  'use strict';

  /* Keyed by "<apiVersion>/<kind>", not by apiVersion alone: the same group and
   * version was removed for some kinds and kept for others, so a key of
   * apiVersion alone would misreport. `removedIn` is the release that stopped
   * serving it — the number that decides whether a manifest is merely old or
   * actually broken. */
  var DEPRECATED = {
    // Removed in 1.16
    'extensions/v1beta1/Deployment': { removedIn: '1.16', replacement: 'apps/v1' },
    'extensions/v1beta1/DaemonSet': { removedIn: '1.16', replacement: 'apps/v1' },
    'extensions/v1beta1/ReplicaSet': { removedIn: '1.16', replacement: 'apps/v1' },
    'extensions/v1beta1/NetworkPolicy': { removedIn: '1.16', replacement: 'networking.k8s.io/v1' },
    'extensions/v1beta1/PodSecurityPolicy': { removedIn: '1.16', replacement: null },
    'apps/v1beta1/Deployment': { removedIn: '1.16', replacement: 'apps/v1' },
    'apps/v1beta1/StatefulSet': { removedIn: '1.16', replacement: 'apps/v1' },
    'apps/v1beta2/Deployment': { removedIn: '1.16', replacement: 'apps/v1' },
    'apps/v1beta2/DaemonSet': { removedIn: '1.16', replacement: 'apps/v1' },
    'apps/v1beta2/ReplicaSet': { removedIn: '1.16', replacement: 'apps/v1' },
    'apps/v1beta2/StatefulSet': { removedIn: '1.16', replacement: 'apps/v1' },
    'apps/v1beta1/ControllerRevision': { removedIn: '1.16', replacement: 'apps/v1' },
    'apps/v1beta2/ControllerRevision': { removedIn: '1.16', replacement: 'apps/v1' },

    // Removed in 1.22
    'extensions/v1beta1/Ingress': { removedIn: '1.22', replacement: 'networking.k8s.io/v1' },
    'networking.k8s.io/v1beta1/Ingress': { removedIn: '1.22', replacement: 'networking.k8s.io/v1' },
    'networking.k8s.io/v1beta1/IngressClass': { removedIn: '1.22', replacement: 'networking.k8s.io/v1' },
    'rbac.authorization.k8s.io/v1beta1/Role': { removedIn: '1.22', replacement: 'rbac.authorization.k8s.io/v1' },
    'rbac.authorization.k8s.io/v1beta1/RoleBinding': { removedIn: '1.22', replacement: 'rbac.authorization.k8s.io/v1' },
    'rbac.authorization.k8s.io/v1beta1/ClusterRole': { removedIn: '1.22', replacement: 'rbac.authorization.k8s.io/v1' },
    'rbac.authorization.k8s.io/v1beta1/ClusterRoleBinding': { removedIn: '1.22', replacement: 'rbac.authorization.k8s.io/v1' },
    'apiextensions.k8s.io/v1beta1/CustomResourceDefinition': { removedIn: '1.22', replacement: 'apiextensions.k8s.io/v1' },
    'admissionregistration.k8s.io/v1beta1/ValidatingWebhookConfiguration': { removedIn: '1.22', replacement: 'admissionregistration.k8s.io/v1' },
    'admissionregistration.k8s.io/v1beta1/MutatingWebhookConfiguration': { removedIn: '1.22', replacement: 'admissionregistration.k8s.io/v1' },
    'certificates.k8s.io/v1beta1/CertificateSigningRequest': { removedIn: '1.22', replacement: 'certificates.k8s.io/v1' },
    'coordination.k8s.io/v1beta1/Lease': { removedIn: '1.22', replacement: 'coordination.k8s.io/v1' },
    'scheduling.k8s.io/v1beta1/PriorityClass': { removedIn: '1.22', replacement: 'scheduling.k8s.io/v1' },
    'storage.k8s.io/v1beta1/CSIDriver': { removedIn: '1.22', replacement: 'storage.k8s.io/v1' },
    'storage.k8s.io/v1beta1/CSINode': { removedIn: '1.22', replacement: 'storage.k8s.io/v1' },
    'storage.k8s.io/v1beta1/StorageClass': { removedIn: '1.22', replacement: 'storage.k8s.io/v1' },
    'storage.k8s.io/v1beta1/VolumeAttachment': { removedIn: '1.22', replacement: 'storage.k8s.io/v1' },

    // Removed in 1.25
    'batch/v1beta1/CronJob': { removedIn: '1.25', replacement: 'batch/v1' },
    'policy/v1beta1/PodDisruptionBudget': { removedIn: '1.25', replacement: 'policy/v1' },
    'policy/v1beta1/PodSecurityPolicy': { removedIn: '1.25', replacement: null },
    'discovery.k8s.io/v1beta1/EndpointSlice': { removedIn: '1.25', replacement: 'discovery.k8s.io/v1' },
    'autoscaling/v2beta1/HorizontalPodAutoscaler': { removedIn: '1.25', replacement: 'autoscaling/v2' },
    'node.k8s.io/v1beta1/RuntimeClass': { removedIn: '1.25', replacement: 'node.k8s.io/v1' },
    'events.k8s.io/v1beta1/Event': { removedIn: '1.25', replacement: 'events.k8s.io/v1' },

    // Removed in 1.26
    'autoscaling/v2beta2/HorizontalPodAutoscaler': { removedIn: '1.26', replacement: 'autoscaling/v2' },
    'flowcontrol.apiserver.k8s.io/v1beta1/FlowSchema': { removedIn: '1.26', replacement: 'flowcontrol.apiserver.k8s.io/v1' },
    'flowcontrol.apiserver.k8s.io/v1beta1/PriorityLevelConfiguration': { removedIn: '1.26', replacement: 'flowcontrol.apiserver.k8s.io/v1' },

    // Removed in 1.27
    'storage.k8s.io/v1beta1/CSIStorageCapacity': { removedIn: '1.27', replacement: 'storage.k8s.io/v1' },

    // Removed in 1.29
    'flowcontrol.apiserver.k8s.io/v1beta2/FlowSchema': { removedIn: '1.29', replacement: 'flowcontrol.apiserver.k8s.io/v1' },
    'flowcontrol.apiserver.k8s.io/v1beta2/PriorityLevelConfiguration': { removedIn: '1.29', replacement: 'flowcontrol.apiserver.k8s.io/v1' },

    // Removed in 1.32
    'flowcontrol.apiserver.k8s.io/v1beta3/FlowSchema': { removedIn: '1.32', replacement: 'flowcontrol.apiserver.k8s.io/v1' },
    'flowcontrol.apiserver.k8s.io/v1beta3/PriorityLevelConfiguration': { removedIn: '1.32', replacement: 'flowcontrol.apiserver.k8s.io/v1' }
  };

  /* Where the pod template lives differs by kind, so every container rule goes
   * through this rather than reaching into a hard-coded path. A kind that is not
   * listed has no pod spec, and its container rules are skipped rather than
   * counted as passing — "not checked" and "clean" must not look alike. */
  var POD_SPEC_PATH = {
    Pod: ['spec'],
    Deployment: ['spec', 'template', 'spec'],
    StatefulSet: ['spec', 'template', 'spec'],
    DaemonSet: ['spec', 'template', 'spec'],
    ReplicaSet: ['spec', 'template', 'spec'],
    ReplicationController: ['spec', 'template', 'spec'],
    Job: ['spec', 'template', 'spec'],
    CronJob: ['spec', 'jobTemplate', 'spec', 'template', 'spec']
  };

  var WORKLOAD_KINDS = Object.keys(POD_SPEC_PATH);

  function at(obj, path) {
    var cur = obj;
    for (var i = 0; i < path.length; i++) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[path[i]];
    }
    return cur;
  }

  function podSpecOf(doc) {
    var kind = doc && doc.kind;
    // `kind: toString` would otherwise reach Object.prototype and hand back the
    // whole document as a pod spec. Exported, so it cannot rely on its callers.
    if (typeof kind !== 'string' ||
        !Object.prototype.hasOwnProperty.call(POD_SPEC_PATH, kind)) return undefined;
    var path = POD_SPEC_PATH[kind];
    var spec = path ? at(doc, path) : undefined;
    return spec && typeof spec === 'object' ? spec : undefined;
  }

  /* Init containers are held to the same rules as app containers — a privileged
   * init container is privileged. They are labelled so a finding says which. */
  function containersOf(doc) {
    var spec = podSpecOf(doc);
    if (!spec) return [];
    var out = [];
    if (Array.isArray(spec.containers)) {
      spec.containers.forEach(function (c) { out.push({ c: c, kind: 'container' }); });
    }
    if (Array.isArray(spec.initContainers)) {
      spec.initContainers.forEach(function (c) { out.push({ c: c, kind: 'initContainer' }); });
    }
    return out.filter(function (e) { return e.c && typeof e.c === 'object'; });
  }

  function label(entry) {
    var name = entry.c.name || '(unnamed)';
    return entry.kind === 'initContainer' ? 'initContainer ' + name : 'container ' + name;
  }

  /* The tag is whatever follows the last colon — but only when that colon comes
   * after the last slash. `registry.example.com:5000/app` has a port, not a tag,
   * and reading it as one would report the wrong thing with total confidence. */
  function tagOf(image) {
    if (typeof image !== 'string' || !image) return null;
    var slash = image.lastIndexOf('/');
    var colon = image.lastIndexOf(':');
    return colon > slash ? image.slice(colon + 1) : '';
  }

  /* A container rule that reports once per offending container rather than once
   * per workload — a Deployment with four bad containers is four fixes. */
  function perContainer(test) {
    return function (doc) {
      return containersOf(doc).map(function (entry) {
        var msg = test(entry.c, doc);
        return msg ? { where: label(entry), detail: msg } : null;
      }).filter(Boolean);
    };
  }

  var CHECKS = [
    {
      id: 'no-containers',
      severity: 'error',
      title: 'No containers',
      appliesTo: WORKLOAD_KINDS,
      /* Without this, a workload whose pod template is missing or misindented
       * makes every container rule below return nothing — and `inspect` counts
       * an empty result as passed. The report then says "12 checks passed"
       * about a manifest that will never start a pod, which is the one failure
       * mode this file's header forbids. */
      test: function (doc) {
        var spec = podSpecOf(doc);
        if (spec && Array.isArray(spec.containers) && spec.containers.length) return [];
        return [{
          where: POD_SPEC_PATH[doc.kind].concat('containers').join('.'),
          detail: 'No container list at this path, so every container rule below was ' +
            'skipped rather than passed. Check the pod template indentation.'
        }];
      }
    },
    {
      id: 'deprecated-api-version',
      severity: 'error',
      title: 'Removed apiVersion',
      appliesTo: null,   // every kind
      test: function (doc) {
        if (!doc || !doc.apiVersion || !doc.kind) return [];
        var hit = DEPRECATED[doc.apiVersion + '/' + doc.kind];
        if (!hit) return [];
        return [{
          where: doc.apiVersion,
          detail: hit.replacement
            ? 'Stopped being served in Kubernetes ' + hit.removedIn + '. Use ' +
              hit.replacement + '.'
            : 'Stopped being served in Kubernetes ' + hit.removedIn + '. It has no ' +
              'replacement API — Pod Security Admission covers this now.'
        }];
      }
    },
    {
      id: 'privileged-container',
      severity: 'error',
      title: 'Privileged container',
      appliesTo: WORKLOAD_KINDS,
      test: perContainer(function (c) {
        var sc = c.securityContext;
        return sc && sc.privileged === true
          ? 'privileged: true hands the container the host\'s capabilities. Drop it, ' +
            'or add only the one capability the process actually needs.'
          : null;
      })
    },
    {
      id: 'host-namespace',
      severity: 'error',
      title: 'Shares a host namespace',
      appliesTo: WORKLOAD_KINDS,
      test: function (doc) {
        var spec = podSpecOf(doc);
        if (!spec) return [];
        return ['hostNetwork', 'hostPID', 'hostIPC'].filter(function (k) {
          return spec[k] === true;
        }).map(function (k) {
          return {
            where: k,
            detail: k + ': true removes the isolation between this pod and the node. ' +
              'Only a node-level agent should need it.'
          };
        });
      }
    },
    {
      id: 'unpinned-image',
      severity: 'error',
      title: 'Image is not pinned',
      appliesTo: WORKLOAD_KINDS,
      test: perContainer(function (c) {
        if (typeof c.image !== 'string' || !c.image) return null;
        if (c.image.indexOf('@sha256:') >= 0) return null;   // digest-pinned
        var tag = tagOf(c.image);
        if (tag === '') {
          return 'No tag, so it resolves to :latest. Pin a version or a digest — ' +
            'otherwise a rollout pulls whatever the registry points at that day.';
        }
        if (tag === 'latest') {
          return ':latest is not a version. Two pods from this one manifest can end up ' +
            'on different images. Pin a version or a digest.';
        }
        return null;
      })
    },
    {
      id: 'runs-as-root',
      severity: 'warn',
      title: 'May run as root',
      appliesTo: WORKLOAD_KINDS,
      test: function (doc) {
        var spec = podSpecOf(doc);
        if (!spec) return [];
        var pod = spec.securityContext || {};
        return containersOf(doc).map(function (entry) {
          var sc = entry.c.securityContext || {};
          // A pod-level setting covers every container that does not override it.
          var nonRoot = sc.runAsNonRoot !== undefined ? sc.runAsNonRoot : pod.runAsNonRoot;
          var uid = sc.runAsUser !== undefined ? sc.runAsUser : pod.runAsUser;
          if (nonRoot === true) return null;
          if (typeof uid === 'number' && uid !== 0) return null;
          return {
            where: label(entry),
            detail: uid === 0
              ? 'runAsUser: 0 is root. Set a non-zero UID and runAsNonRoot: true.'
              : 'Neither runAsNonRoot nor a non-zero runAsUser is set, so this runs as ' +
                'whatever user the image declares — root, for most base images.'
          };
        }).filter(Boolean);
      }
    },
    {
      id: 'privilege-escalation',
      severity: 'warn',
      title: 'Privilege escalation not blocked',
      appliesTo: WORKLOAD_KINDS,
      test: perContainer(function (c) {
        var sc = c.securityContext || {};
        return sc.allowPrivilegeEscalation === false
          ? null
          : 'allowPrivilegeEscalation is not false, so a setuid binary inside the ' +
            'container can gain privileges the container was never granted.';
      })
    },
    {
      id: 'added-capabilities',
      severity: 'warn',
      title: 'Adds Linux capabilities',
      appliesTo: WORKLOAD_KINDS,
      test: perContainer(function (c) {
        var caps = c.securityContext && c.securityContext.capabilities;
        var add = caps && caps.add;
        if (!Array.isArray(add) || !add.length) return null;
        return 'Adds ' + add.join(', ') + '. Each one is a hole in the sandbox — drop ALL ' +
          'first, then add back only what the process actually calls.';
      })
    },
    {
      id: 'missing-resource-requests',
      severity: 'warn',
      title: 'No resource requests',
      appliesTo: WORKLOAD_KINDS,
      test: perContainer(function (c) {
        var req = c.resources && c.resources.requests;
        return req && (req.cpu !== undefined || req.memory !== undefined)
          ? null
          : 'Without requests the scheduler has nothing to place this on, and the pod ' +
            'lands in BestEffort — first to be evicted when the node runs short.';
      })
    },
    {
      id: 'missing-resource-limits',
      severity: 'warn',
      title: 'No resource limits',
      appliesTo: WORKLOAD_KINDS,
      test: perContainer(function (c) {
        var lim = c.resources && c.resources.limits;
        return lim && (lim.cpu !== undefined || lim.memory !== undefined)
          ? null
          : 'Without a memory limit this container can take the node down with it. ' +
            'Set at least resources.limits.memory.';
      })
    },
    {
      id: 'missing-probes',
      severity: 'warn',
      title: 'No health probes',
      appliesTo: WORKLOAD_KINDS,
      test: function (doc) {
        // Run-to-completion workloads are supposed to exit; a readiness probe on
        // a Job container means nothing, so the rule does not apply.
        if (doc.kind === 'Job' || doc.kind === 'CronJob') return [];
        var spec = podSpecOf(doc);
        if (!spec || !Array.isArray(spec.containers)) return [];
        return spec.containers.map(function (c) {
          if (!c || typeof c !== 'object') return null;
          var missing = [];
          if (!c.readinessProbe) missing.push('readinessProbe');
          if (!c.livenessProbe) missing.push('livenessProbe');
          if (!missing.length) return null;
          return {
            where: 'container ' + (c.name || '(unnamed)'),
            detail: 'No ' + missing.join(' or ') + '. Without a readiness probe the Service ' +
              'sends traffic the moment the process starts, before it can serve any.'
          };
        }).filter(Boolean);
      }
    },
    {
      id: 'image-pull-policy',
      severity: 'warn',
      title: 'imagePullPolicy left to the default',
      appliesTo: WORKLOAD_KINDS,
      test: perContainer(function (c) {
        if (c.imagePullPolicy) return null;
        /* A digest names the exact bytes, so IfNotPresent carries no stale-cache
         * risk — the cached layer and the referenced layer are the same image by
         * definition. This guard must come first: `tagOf` reads the colon in
         * `@sha256:` as a tag, and `unpinned-image` already skips digests, so
         * without it the two rules contradict each other on the correct input. */
        if (typeof c.image === 'string' && c.image.indexOf('@sha256:') >= 0) return null;
        var tag = tagOf(c.image);
        if (tag === null) return null;
        // The default is derived from the tag, which is the part that surprises
        // people: a fixed tag means the node keeps whatever it already cached.
        return (tag && tag !== 'latest')
          ? 'Unset, so it defaults to IfNotPresent for a fixed tag — a node that already ' +
            'cached this tag will not pull a rebuilt image.'
          : null;
      })
    },
    {
      id: 'replicas-without-pdb',
      severity: 'warn',
      title: 'Replicated with no PodDisruptionBudget',
      appliesTo: ['Deployment', 'StatefulSet', 'ReplicaSet'],
      /* The one rule that cannot be answered by a single document: it is about a
       * resource being absent from the whole input, which is why every test also
       * receives the full set. */
      test: function (doc, all) {
        var replicas = doc.spec && doc.spec.replicas;
        if (typeof replicas !== 'number' || replicas < 2) return [];
        /* A PDB only covers workloads in its own namespace, so matching on kind
         * alone passes a Deployment in prod because a PDB exists in staging —
         * and `passed` means "checked and fine", which makes that a silent lie.
         * Selector matching is not attempted; the detail says so. */
        var ns = (doc.metadata && doc.metadata.namespace) || '';
        var hasPdb = (all || []).some(function (d) {
          return d && d.kind === 'PodDisruptionBudget' &&
            (((d.metadata && d.metadata.namespace) || '') === ns);
        });
        if (hasPdb) return [];
        return [{
          where: 'spec.replicas: ' + replicas,
          detail: 'No PodDisruptionBudget for namespace ' + (ns || '(default)') + ' in ' +
            'this input. A node drain can take every replica down at once. This only ' +
            'checks that a PDB exists in the namespace, not that its selector matches.'
        }];
      }
    }
  ];

  global.KI_RULES = {
    deprecatedApiVersions: DEPRECATED,
    checks: CHECKS,
    podSpecOf: podSpecOf,
    workloadKinds: WORKLOAD_KINDS
  };
})(window);
