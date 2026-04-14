import '../models/voucher.dart';
import 'api_client.dart';

class VoucherService {
  final ApiClient _api = ApiClient();

  Future<VoucherListResult> getVouchers(
    String routerId, {
    String? status,
    String? limitType,
    String? search,
    int page = 1,
    int limit = 20,
  }) async {
    final queryParams = <String, dynamic>{
      'page': page,
      'limit': limit,
    };
    if (status != null) queryParams['status'] = status;
    if (limitType != null) queryParams['limitType'] = limitType;
    if (search != null && search.isNotEmpty) queryParams['search'] = search;

    final response = await _api.dio.get(
      '/routers/$routerId/vouchers',
      queryParameters: queryParams,
    );
    final data = response.data['data'] as List;
    final meta = response.data['meta'] as Map<String, dynamic>?;
    return VoucherListResult(
      vouchers: data.map((e) => Voucher.fromJson(e as Map<String, dynamic>)).toList(),
      total: meta?['total'] != null ? int.parse(meta!['total'].toString()) : data.length,
      page: meta?['page'] != null ? int.parse(meta!['page'].toString()) : page,
      limit: meta?['limit'] != null ? int.parse(meta!['limit'].toString()) : limit,
    );
  }

  Future<Voucher> getVoucher(String routerId, String voucherId) async {
    final response = await _api.dio.get('/routers/$routerId/vouchers/$voucherId');
    return Voucher.fromJson(response.data['data'] as Map<String, dynamic>);
  }

  Future<List<Voucher>> createVouchers({
    required String routerId,
    required String limitType,
    required int limitValue,
    required String limitUnit,
    int? validitySeconds,
    required int count,
    required double price,
  }) async {
    final body = <String, dynamic>{
      'limitType': limitType,
      'limitValue': limitValue,
      'limitUnit': limitUnit,
      'count': count,
      'price': price,
    };
    if (validitySeconds != null && validitySeconds > 0) {
      body['validitySeconds'] = validitySeconds;
    }

    final response = await _api.dio.post(
      '/routers/$routerId/vouchers',
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

  Future<int> bulkDeleteVouchers(String routerId, {required List<String> ids}) async {
    final response = await _api.dio.post(
      '/routers/$routerId/vouchers/bulk-delete',
      data: {'ids': ids},
    );
    return response.data['data']['deletedCount'] as int;
  }

  Future<int> deleteAllVouchers(
    String routerId, {
    String? status,
    String? limitType,
    String? search,
  }) async {
    final filter = <String, dynamic>{'all': true};
    if (status != null) filter['status'] = status;
    if (limitType != null) filter['limitType'] = limitType;
    if (search != null && search.isNotEmpty) filter['search'] = search;
    final response = await _api.dio.post(
      '/routers/$routerId/vouchers/bulk-delete',
      data: {'filter': filter},
    );
    return response.data['data']['deletedCount'] as int;
  }

  Future<List<Voucher>> getAllVouchers(
    String routerId, {
    String? status,
    String? limitType,
    String? search,
    int? maxCount,
  }) async {
    final List<Voucher> allVouchers = [];
    int page = 1;
    const limit = 500;

    while (true) {
      final result = await getVouchers(
        routerId,
        status: status,
        limitType: limitType,
        search: search,
        page: page,
        limit: limit,
      );
      allVouchers.addAll(result.vouchers);

      if (maxCount != null && allVouchers.length >= maxCount) {
        return allVouchers.sublist(0, maxCount);
      }
      if (allVouchers.length >= result.total) break;
      page++;
    }

    return allVouchers;
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
