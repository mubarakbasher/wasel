import '../models/router_model.dart';
import 'api_client.dart';

class RouterSystemInfo {
  final String identity;
  final String uptime;
  final int cpuLoad;
  final int freeMemory;
  final int totalMemory;
  final String boardName;
  final String architecture;
  final String version;
  final String? model;
  final String? serialNumber;
  final String? firmware;

  const RouterSystemInfo({
    required this.identity,
    required this.uptime,
    required this.cpuLoad,
    required this.freeMemory,
    required this.totalMemory,
    required this.boardName,
    required this.architecture,
    required this.version,
    this.model,
    this.serialNumber,
    this.firmware,
  });

  factory RouterSystemInfo.fromJson(Map<String, dynamic> json) {
    return RouterSystemInfo(
      identity: json['identity'] as String? ?? '',
      uptime: json['uptime'] as String? ?? '',
      cpuLoad: (json['cpuLoad'] as num?)?.toInt() ?? 0,
      freeMemory: (json['freeMemory'] as num?)?.toInt() ?? 0,
      totalMemory: (json['totalMemory'] as num?)?.toInt() ?? 0,
      boardName: json['boardName'] as String? ?? '',
      architecture: json['architecture'] as String? ?? '',
      version: json['version'] as String? ?? '',
      model: json['model'] as String?,
      serialNumber: json['serialNumber'] as String?,
      firmware: json['firmware'] as String?,
    );
  }
}

class RouterStatusInfo {
  final String id;
  final String name;
  final String status;
  final DateTime? lastSeen;
  final String? tunnelIp;
  final bool? liveDataAvailable;
  final RouterSystemInfo? systemInfo;

  const RouterStatusInfo({
    required this.id,
    required this.name,
    required this.status,
    this.lastSeen,
    this.tunnelIp,
    this.liveDataAvailable,
    this.systemInfo,
  });

  factory RouterStatusInfo.fromJson(Map<String, dynamic> json) {
    return RouterStatusInfo(
      id: json['id'] as String,
      name: json['name'] as String,
      status: json['status'] as String? ?? 'offline',
      lastSeen: json['lastSeen'] != null
          ? DateTime.parse(json['lastSeen'] as String)
          : null,
      tunnelIp: json['tunnelIp'] as String?,
      liveDataAvailable: json['liveDataAvailable'] as bool?,
      systemInfo: json['systemInfo'] != null
          ? RouterSystemInfo.fromJson(
              json['systemInfo'] as Map<String, dynamic>)
          : null,
    );
  }
}

class SetupStep {
  final int step;
  final String title;
  final String description;
  final String command;

  const SetupStep({
    required this.step,
    required this.title,
    required this.description,
    required this.command,
  });

  factory SetupStep.fromJson(Map<String, dynamic> json) {
    return SetupStep(
      step: (json['step'] as num).toInt(),
      title: json['title'] as String,
      description: json['description'] as String,
      command: json['command'] as String,
    );
  }
}

class RouterSetupGuide {
  final String routerName;
  final String setupGuide;
  final String? tunnelIp;
  final String serverEndpoint;
  final List<SetupStep> steps;

  const RouterSetupGuide({
    required this.routerName,
    required this.setupGuide,
    this.tunnelIp,
    this.serverEndpoint = '',
    this.steps = const [],
  });

  factory RouterSetupGuide.fromJson(Map<String, dynamic> json) {
    return RouterSetupGuide(
      routerName: json['routerName'] as String,
      setupGuide: json['setupGuide'] as String,
      tunnelIp: json['tunnelIp'] as String?,
      serverEndpoint: json['serverEndpoint'] as String? ?? '',
      steps: (json['steps'] as List<dynamic>?)
              ?.map((e) => SetupStep.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }
}

/// Bundle returned by [RouterService.createRouter].
class CreateRouterResult {
  final RouterModel router;
  final RouterSetupGuide setupGuide;

  const CreateRouterResult({
    required this.router,
    required this.setupGuide,
  });
}

class RouterService {
  final ApiClient _api = ApiClient();

  Future<List<RouterModel>> getRouters() async {
    final response = await _api.dio.get('/routers');
    final data = response.data['data'] as List;
    return data
        .map((e) => RouterModel.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<RouterModel> getRouter(String id) async {
    final response = await _api.dio.get('/routers/$id');
    return RouterModel.fromJson(response.data['data'] as Map<String, dynamic>);
  }

  Future<CreateRouterResult> createRouter({required String name}) async {
    final response = await _api.dio.post('/routers', data: {'name': name});
    final data = response.data['data'] as Map<String, dynamic>;

    final router = RouterModel.fromJson(data['router'] as Map<String, dynamic>);

    final rawSteps = (data['steps'] as List<dynamic>?)
            ?.map((e) => SetupStep.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const <SetupStep>[];

    final setupGuide = RouterSetupGuide(
      routerName: router.name,
      tunnelIp: data['vpnIp'] as String?,
      steps: rawSteps,
      // Concatenate all commands for "Copy All" — newline-separated.
      setupGuide: rawSteps.map((s) => s.command).join('\n'),
    );

    return CreateRouterResult(router: router, setupGuide: setupGuide);
  }

  Future<RouterModel> updateRouter(
    String id, {
    String? name,
    String? model,
    String? rosVersion,
    String? apiUser,
    String? apiPass,
  }) async {
    final body = <String, dynamic>{};
    if (name != null) body['name'] = name;
    if (model != null) body['model'] = model;
    if (rosVersion != null) body['rosVersion'] = rosVersion;
    if (apiUser != null) body['apiUser'] = apiUser;
    if (apiPass != null) body['apiPass'] = apiPass;

    final response = await _api.dio.put('/routers/$id', data: body);
    return RouterModel.fromJson(response.data['data'] as Map<String, dynamic>);
  }

  Future<void> deleteRouter(String id) async {
    await _api.dio.delete('/routers/$id');
  }

  Future<RouterStatusInfo> getRouterStatus(String id) async {
    final response = await _api.dio.get('/routers/$id/status');
    return RouterStatusInfo.fromJson(
        response.data['data'] as Map<String, dynamic>);
  }

  Future<RouterSetupGuide> getSetupGuide(String id) async {
    final response = await _api.dio.get('/routers/$id/setup-guide');
    return RouterSetupGuide.fromJson(
        response.data['data'] as Map<String, dynamic>);
  }

  /// POST /routers/:id/reprovision — triggers re-running auto-provisioning.
  /// Returns 202 Accepted; the caller should then poll health to track progress.
  Future<void> reprovisionRouter(String id) async {
    await _api.dio.post('/routers/$id/reprovision');
  }

  /// POST /routers/:id/provision/hotspot — confirms the hotspot interface.
  /// Called when the operator selects a LAN interface for the hotspot server.
  Future<void> confirmHotspotInterface(String id, String interfaceName) async {
    await _api.dio.post(
      '/routers/$id/provision/hotspot',
      data: {'interface': interfaceName},
    );
  }
}
