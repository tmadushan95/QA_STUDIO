using System.Data.Common;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;

namespace QaStudio.Infrastructure.Persistence.Dapper;

/// <summary>
/// Opens SQL Server connections for Dapper. The connection string is read on first use, not at registration, for the
/// same reason as the DbContext: configuration is only final once the host is built (integration tests override it).
/// </summary>
/// <param name="configuration">Final application configuration.</param>
internal sealed class SqlConnectionFactory(IConfiguration configuration) : ISqlConnectionFactory
{
    private readonly Lazy<string> _connectionString = new(() =>
        configuration.GetConnectionString(DependencyInjection.ConnectionName)
        ?? throw new InvalidOperationException($"Connection string \"{DependencyInjection.ConnectionName}\" is not configured."));

    public async Task<DbConnection> OpenAsync(CancellationToken cancellationToken)
    {
        var connection = new SqlConnection(_connectionString.Value);
        try
        {
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
            return connection;
        }
        catch
        {
            await connection.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }
}
