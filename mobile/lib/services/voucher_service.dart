import '../models/voucher.dart';
import 'api_client.dart';

class VoucherService {
  final ApiClient _api = ApiClient();

  Future<VoucherListResult> getVouchers(
    String routerId, {
    String? status,
    String? profileId,
    String? search,
    int page = 1,
    int limit = 20,
  }) async {
    final queryParams = <String, dynamic>{
      'page': page,
      'limit': limit,
    };
    if (status != null) queryParams['status'] = status;
    if (profileId != null) queryParams['profileId'] = profileId;
    if (search != null && search.isNotEmpty) queryParams['search'] = search;

    final response = await _api.dio.get(
      '/routers/$routerId/vouchers',
      queryParameters: queryParams,
    );
    final data = response.data['data'] as List;
    final meta = response.data['meta'] as Map<String, dynamic>?;
    return VoucherListResult(
      vouchers: data.map((e) => Voucher.fromJson(e as Map<String, dynamic>)).toList(),
      total: meta?['total'] as int? ?? data.length,
      page: meta?['page'] as int? ?? page,
      limit: meta?['limit'] as int? ?? limit,
    );
  }

  Future<Voucher> getVoucher(String routerId, String voucherId) async {
    final response = await _api.dio.get('/routers/$routerId/vouchers/$voucherId');
    return Voucher.fromJson(response.data['data'] as Map<String, dynamic>);
  }

  Future<Voucher> createVoucher({
    required String routerId,
    required String profileId,
    String? username,
    String? password,
    String? comment,
    String? expiration,
    int? simultaneousUse,
  }) async {
    final body = <String, dynamic>{
      'profileId': profileId,
    };
    if (username != null && username.isNotEmpty) body['username'] = username;
    if (password != null && password.isNotEmpty) body['password'] = password;
    if (comment != null && comment.isNotEmpty) body['comment'] = comment;
    if (expiration != null) body['expiration'] = expiration;
    if (simultaneousUse != null) body['simultaneousUse'] = simultaneousUse;

    final response = await _api.dio.post(
      '/routers/$routerId/vouchers',
      data: body,
    );
    return Voucher.fromJson(response.data['data'] as Map<String, dynamic>);
  }

  Future<List<Voucher>> createVouchersBulk({
    required String routerId,
    required String profileId,
    required int count,
    String? usernamePrefix,
    int? usernameLength,
    int? passwordLength,
    String? comment,
    String? expiration,
    int? simultaneousUse,
  }) async {
    final body = <String, dynamic>{
      'profileId': profileId,
      'count': count,
    };
    if (usernamePrefix != null && usernamePrefix.isNotEmpty) {
      body['usernamePrefix'] = usernamePrefix;
    }
    if (usernameLength != null) body['usernameLength'] = usernameLength;
    if (passwordLength != null) body['passwordLength'] = passwordLength;
    if (comment != null && comment.isNotEmpty) body['comment'] = comment;
    if (expiration != null) body['expiration'] = expiration;
    if (simultaneousUse != null) body['simultaneousUse'] = simultaneousUse;

    final response = await _api.dio.post(
      '/routers/$routerId/vouchers/bulk',
      data: body,
    );
    final data = response.data['data'] as List;
    return data.map((e) => Voucher.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<Voucher> updateVoucher(
    String routerId,
    String voucherId, {
    String? status,
    String? expiration,
    String? comment,
  }) async {
    final body = <String, dynamic>{};
    if (status != null) body['status'] = status;
    if (expiration != null) body['expiration'] = expiration;
    if (comment != null) body['comment'] = comment;

    final response = await _api.dio.put(
      '/routers/$routerId/vouchers/$voucherId',
      data: body,
    );
    return Voucher.fromJson(response.data['data'] as Map<String, dynamic>);
  }

  Future<void> deleteVoucher(String routerId, String voucherId) async {
    await _api.dio.delete('/routers/$routerId/vouchers/$voucherId');
  }
}

class VoucherListResult {
  final List<Voucher> vouchers;
  final int total;
  final int page;
  final int limit;

  const VoucherListResult({
    required this.vouchers,
    required this.total,
    required this.page,
    required this.limit,
  });
}
