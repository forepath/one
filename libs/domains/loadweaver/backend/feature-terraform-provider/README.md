# loadweaver-backend-feature-terraform-provider

The Loadweaver Terraform provider (`forepath/loadweaver`): provider configuration, resource and data source schemas,
and the mapping of plan / apply / read / import onto Loadweaver plans (dry-run plans on `terraform plan`, applied
plans with approval waiting on `terraform apply`). The executable is `apps/loadweaver/terraform-provider`; the guide
is `docs/loadweaver/guides/terraform.md`.

Run `nx test loadweaver-backend-feature-terraform-provider` to execute the unit tests.
