using System.Data.Common;

namespace QaStudio.Infrastructure.Persistence.Dapper;

/// <summary>Opens connections for the Dapper read side. Same connection string, and so the same pool, as EF Core.</summary>
internal interface ISqlConnectionFactory
{
    /// <summary>Opens a new connection; the caller disposes it.</summary>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>An open connection.</returns>
    Task<DbConnection> OpenAsync(CancellationToken cancellationToken);
}
